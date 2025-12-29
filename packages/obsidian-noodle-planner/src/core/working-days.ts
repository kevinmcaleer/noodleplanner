/**
 * Working days calculations - ported from scheduling_engine.py
 */

/**
 * Get the next working day from a given date.
 * If the given date is already a working day, return it.
 * Otherwise, find the next working day (skipping weekends and holidays).
 *
 * @param date - The date to check
 * @param holidays - Set of holiday dates to skip (ISO strings YYYY-MM-DD)
 * @returns The next working day
 */
export function getNextWorkingDay(date: Date, holidays: Set<string> = new Set()): Date {
  const currentDate = new Date(date);

  while (true) {
    const dayOfWeek = currentDate.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6; // Sunday=0, Saturday=6
    const dateStr = formatDateISO(currentDate);
    const isHoliday = holidays.has(dateStr);

    if (!isWeekend && !isHoliday) {
      return currentDate;
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }
}

/**
 * Add working days to a start date, skipping weekends and holidays.
 * The finish date is the day AFTER the last working day (exclusive).
 *
 * For example, a 1-day task starting Monday will have finish = Tuesday.
 * A 5-day task starting Monday will have finish = following Monday.
 *
 * @param startDate - The starting date
 * @param numDays - Number of working days to add (can be negative)
 * @param holidays - Set of holiday dates to skip (ISO strings YYYY-MM-DD)
 * @returns The finish date (exclusive - day after last working day)
 */
export function addWorkingDays(startDate: Date, numDays: number, holidays: Set<string> = new Set()): Date {
  if (numDays === 0) {
    // Zero-duration tasks (milestones) finish on the same day
    return new Date(startDate);
  }

  // Handle negative days (going backwards)
  if (numDays < 0) {
    const currentDate = new Date(startDate);
    let daysSubtracted = 0;
    const targetDays = Math.abs(numDays);

    while (daysSubtracted < targetDays) {
      currentDate.setDate(currentDate.getDate() - 1);

      const dayOfWeek = currentDate.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const dateStr = formatDateISO(currentDate);
      const isHoliday = holidays.has(dateStr);

      if (!isWeekend && !isHoliday) {
        daysSubtracted++;
      }
    }

    return currentDate;
  }

  // Handle positive days (going forward)
  // Ensure we start from a working day
  let currentDate = getNextWorkingDay(startDate, holidays);
  let daysAdded = 1; // Start day counts as day 1

  // Add remaining days
  while (daysAdded < numDays) {
    currentDate.setDate(currentDate.getDate() + 1);

    const dayOfWeek = currentDate.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const dateStr = formatDateISO(currentDate);
    const isHoliday = holidays.has(dateStr);

    if (!isWeekend && !isHoliday) {
      daysAdded++;
    }
  }

  // Return the day AFTER the last working day (finish date is exclusive for rendering)
  const finishDate = new Date(currentDate);
  finishDate.setDate(finishDate.getDate() + 1);
  return finishDate;
}

/**
 * Parse duration string like '+2d', '-1w', '+3m' to number of days.
 * Supports: d (days), w (weeks), m (months - 30 days), y (years - 365 days)
 *
 * @param durationStr - Duration string (e.g., "+2d", "-1w")
 * @returns Number of days (positive for lag, negative for lead)
 */
export function parseDurationToDays(durationStr: string): number {
  if (!durationStr) {
    return 0;
  }

  const match = durationStr.match(/([+\-])(\d+)([dwmy])/);
  if (!match) {
    return 0;
  }

  const sign = match[1];
  const number = parseInt(match[2], 10);
  const unit = match[3];

  // Convert to days
  const multipliers: Record<string, number> = { d: 1, w: 7, m: 30, y: 365 };
  const days = number * (multipliers[unit] || 1);

  return sign === '+' ? days : -days;
}

/**
 * Format a Date as ISO string (YYYY-MM-DD)
 */
export function formatDateISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parse an ISO date string to Date object
 */
export function parseISODate(dateStr: string): Date | null {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
}

/**
 * Calculate working days between two dates
 */
export function workingDaysBetween(start: Date, end: Date, holidays: Set<string> = new Set()): number {
  let count = 0;
  const current = new Date(start);

  while (current < end) {
    const dayOfWeek = current.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const dateStr = formatDateISO(current);
    const isHoliday = holidays.has(dateStr);

    if (!isWeekend && !isHoliday) {
      count++;
    }

    current.setDate(current.getDate() + 1);
  }

  return count;
}
