/**
 * Dynamic Appointment & Architecture Call Scheduling Bridge
 * Generates calibrated Cal.com or portfolio booking URLs with prefilled metadata.
 */

import { SchedulingOptions } from "./types.js";

const DEFAULT_CAL_BASE = process.env.CAL_BOOKING_URL || "https://cal.com/sam-codesai/15min";
const FALLBACK_PORTFOLIO_CONTACT = "https://sam-codes.vercel.app/#contact";

/**
 * Builds an interactive booking URL with query parameters pre-populated
 * from qualified conversational lead data.
 */
export function buildSchedulingUrl(options: SchedulingOptions = {}): string {
  const baseUrl = options.calBaseUrl || DEFAULT_CAL_BASE;

  try {
    const url = new URL(baseUrl);

    if (options.name && options.name.trim()) {
      url.searchParams.set("name", options.name.trim());
    }
    if (options.email && options.email.includes("@") && !options.email.startsWith("@")) {
      url.searchParams.set("email", options.email.trim());
    }
    if (options.notes && options.notes.trim()) {
      // Truncate notes if necessary to avoid exceeding browser URL length limits
      url.searchParams.set("notes", options.notes.trim().slice(0, 500));
    }

    return url.toString();
  } catch {
    // If baseUrl is malformed, safely fall back to the portfolio contact form
    return FALLBACK_PORTFOLIO_CONTACT;
  }
}
