/**
 * Dynamic Appointment & Architecture Call Scheduling Bridge
 * Generates calibrated Cal.com or portfolio booking URLs with prefilled metadata.
 */

import { SchedulingOptions } from "./types.js";

const DEFAULT_CAL_BASE = process.env.CAL_BOOKING_URL || "https://cal.com/samarth/discovery";
const FALLBACK_PORTFOLIO_CONTACT = "https://sam-codes.vercel.app/#contact";

/**
 * Builds an interactive booking URL with query parameters pre-populated
 * from qualified conversational lead data.
 */
export function buildSchedulingUrl(options: SchedulingOptions = {}): string {
  const baseUrl = options.calBaseUrl || DEFAULT_CAL_BASE;

  try {
    const url = new URL(baseUrl);

    if (options.name) {
      url.searchParams.set("name", options.name);
    }
    if (options.email) {
      url.searchParams.set("email", options.email);
    }
    if (options.notes) {
      // Truncate notes if necessary to avoid exceeding browser URL length limits
      url.searchParams.set("notes", options.notes.slice(0, 500));
    }

    return url.toString();
  } catch {
    // If baseUrl is malformed, safely fall back to the portfolio contact form
    return FALLBACK_PORTFOLIO_CONTACT;
  }
}
