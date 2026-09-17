import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const mockSupabase = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

vi.mock('../../src/config/db.js', () => ({
  supabaseAdmin: mockSupabase,
  supabase: mockSupabase,
  redisClient: null,
}));

import { incrementOtpAttempts } from '../../src/services/otpService.js';

describe('incrementOtpAttempts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 0 when otpId is missing or falsy', async () => {
    const resultNull = await incrementOtpAttempts(null);
    const resultEmpty = await incrementOtpAttempts('');
    expect(resultNull).toBe(0);
    expect(resultEmpty).toBe(0);
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('uses atomic RPC when increment_otp_attempts succeeds', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: 3,
      error: null,
    });

    const result = await incrementOtpAttempts('test-otp-uuid-1');

    expect(mockSupabase.rpc).toHaveBeenCalledWith('increment_otp_attempts', {
      p_otp_id: 'test-otp-uuid-1',
    });
    expect(result).toBe(3);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('falls back to numeric fetch-and-update when RPC fails', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'function increment_otp_attempts does not exist', code: 'PGRST202' },
    });

    const selectChain = {
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValueOnce({
        data: { attempts: 2 },
        error: null,
      }),
    };

    const updateChain = {
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValueOnce({
        data: { attempts: 3 },
        error: null,
      }),
    };

    mockSupabase.from.mockImplementation((table) => {
      expect(table).toBe('phone_otps');
      return {
        select: vi.fn().mockReturnValue(selectChain),
        update: vi.fn((payload) => {
          expect(payload).toEqual({ attempts: 3 });
          return updateChain;
        }),
      };
    });

    const result = await incrementOtpAttempts('test-otp-uuid-2');

    expect(mockSupabase.rpc).toHaveBeenCalledWith('increment_otp_attempts', {
      p_otp_id: 'test-otp-uuid-2',
    });
    expect(result).toBe(3);
  });

  it('handles null/missing current attempts on fallback and starts at 1', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'RPC not available' },
    });

    const selectChain = {
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValueOnce({
        data: { attempts: null },
        error: null,
      }),
    };

    const updateChain = {
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValueOnce({
        data: { attempts: 1 },
        error: null,
      }),
    };

    mockSupabase.from.mockImplementation((table) => {
      return {
        select: vi.fn().mockReturnValue(selectChain),
        update: vi.fn((payload) => {
          expect(payload).toEqual({ attempts: 1 });
          return updateChain;
        }),
      };
    });

    const result = await incrementOtpAttempts('test-otp-uuid-3');
    expect(result).toBe(1);
  });

  it('logs error and returns 0 if fetch fails during fallback', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'RPC not available' },
    });

    const selectChain = {
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValueOnce({
        data: null,
        error: { message: 'Record not found' },
      }),
    };

    mockSupabase.from.mockImplementation(() => ({
      select: vi.fn().mockReturnValue(selectChain),
    }));

    const result = await incrementOtpAttempts('non-existent-otp');
    expect(result).toBe(0);
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('logs error and returns 0 if update fails during fallback', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'RPC not available' },
    });

    const selectChain = {
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValueOnce({
        data: { attempts: 1 },
        error: null,
      }),
    };

    const updateChain = {
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValueOnce({
        data: null,
        error: { message: 'Database write error' },
      }),
    };

    mockSupabase.from.mockImplementation(() => ({
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue(updateChain),
    }));

    const result = await incrementOtpAttempts('test-otp-uuid-4');
    expect(result).toBe(0);
    expect(mockLogger.error).toHaveBeenCalled();
  });
});
