-- Migration: Add increment_otp_attempts RPC function
-- Fixes race conditions and type coercion errors when incrementing OTP verification attempts.
-- Used by incrementOtpAttempts() in otpService.js.

ALTER TABLE IF EXISTS public.phone_otps
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.increment_otp_attempts(p_otp_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_attempts INTEGER;
BEGIN
  UPDATE public.phone_otps
  SET attempts = COALESCE(attempts, 0) + 1
  WHERE id = p_otp_id
  RETURNING attempts INTO v_new_attempts;

  RETURN COALESCE(v_new_attempts, 0);
END;
$$;

-- Revoke default public execution privileges and restrict strictly to service_role
REVOKE ALL ON FUNCTION public.increment_otp_attempts(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_otp_attempts(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.increment_otp_attempts(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.increment_otp_attempts(UUID) TO service_role;
