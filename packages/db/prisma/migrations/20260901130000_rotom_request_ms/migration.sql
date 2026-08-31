-- The mean request duration, so the latency tile on the scanner page has the
-- same history behind it as the three numbers beside it. Null under the same
-- rule as the rate — a Rotom that does not measure says nothing — plus one of
-- its own: no requests in the window leaves nothing to average.

-- AlterTable
ALTER TABLE "RotomSample" ADD COLUMN     "requestMs" DOUBLE PRECISION;
