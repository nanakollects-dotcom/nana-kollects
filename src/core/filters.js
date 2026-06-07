const MS_PER_DAY = 24 * 60 * 60 * 1000;

const startOfDay = (date) => {
  const nextDate = new Date(date);
  nextDate.setHours(0, 0, 0, 0);
  return nextDate;
};

const endOfDay = (date) => {
  const nextDate = new Date(date);
  nextDate.setHours(23, 59, 59, 999);
  return nextDate;
};

const formatLabelDate = (date) =>
  new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric" }).format(date);

export function getDateRange(period, customRange = {}) {
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  if (period === "all") return { startDate: null, endDate: null, label: "All Time" };
  if (period === "today") return { startDate: todayStart, endDate: todayEnd, label: "Today" };

  if (period === "yesterday") {
    const yesterday = new Date(todayStart.getTime() - MS_PER_DAY);
    return { startDate: startOfDay(yesterday), endDate: endOfDay(yesterday), label: "Yesterday" };
  }

  if (period === "week" || period === "last-week") {
    const startDate = startOfDay(now);
    const day = startDate.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    startDate.setDate(startDate.getDate() + mondayOffset);

    if (period === "last-week") {
      startDate.setDate(startDate.getDate() - 7);
      const endDate = endOfDay(new Date(startDate.getTime() + (6 * MS_PER_DAY)));
      return { startDate, endDate, label: "Last Week" };
    }

    return { startDate, endDate: todayEnd, label: "This Week" };
  }

  if (period === "month" || period === "last-month") {
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1);

    if (period === "last-month") {
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0));
      return { startDate: lastMonthStart, endDate: lastMonthEnd, label: "Last Month" };
    }

    return { startDate, endDate: todayEnd, label: "This Month" };
  }

  if (period === "last-30-days") {
    return { startDate: startOfDay(new Date(todayStart.getTime() - (29 * MS_PER_DAY))), endDate: todayEnd, label: "Last 30 Days" };
  }

  if (period === "year") {
    return { startDate: new Date(now.getFullYear(), 0, 1), endDate: todayEnd, label: "This Year" };
  }

  if (period === "custom") {
    const startDate = customRange.startDate ? startOfDay(new Date(customRange.startDate)) : null;
    const endDate = customRange.endDate ? endOfDay(new Date(customRange.endDate)) : null;
    const label = startDate && endDate
      ? `Custom: ${formatLabelDate(startDate)} - ${formatLabelDate(endDate)}`
      : "Custom Range";

    return { startDate, endDate, label };
  }

  return { startDate: todayStart, endDate: todayEnd, label: "Today" };
}

export function isWithinRange(dateValue, filters = {}) {
  const date = new Date(dateValue);
  if (filters.startDate && date < filters.startDate) return false;
  if (filters.endDate && date > filters.endDate) return false;
  return true;
}
