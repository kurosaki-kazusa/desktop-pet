// P3-M5~M6 日期区间映射与定点提醒日期规则：主进程、Node 测试与工作台共用。
(function exposeTaskRules(root, factory) {
  const rules = factory();
  if (typeof module === 'object' && module.exports) module.exports = rules;
  else root.taskRules = rules;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const DAY_MS = 86400000;

  function dayNumber(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return NaN;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const time = Date.UTC(year, month - 1, day);
    const date = new Date(time);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return NaN;
    return Math.floor(time / DAY_MS);
  }

  function isIsoDate(value) {
    return Number.isFinite(dayNumber(value));
  }

  function shouldMapRangeTask(task, selectedDate) {
    if (!task || task.kind !== 'range' || task.completed === true) return false;
    const selected = dayNumber(selectedDate);
    const start = dayNumber(task.startDate);
    const end = dayNumber(task.endDate);
    if (![selected, start, end].every(Number.isFinite) || start > end || selected < start || selected > end) return false;
    if (task.priority === 'high') return true;
    return selected >= Math.max(start, end - 6);
  }

  function isTaskCompletedOn(task, isoDate) {
    if (!task || task.completed !== true || !isIsoDate(isoDate)) return false;
    const timestamp = Number(task.completedAt) || Number(task.updatedAt);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return false;
    const date = new Date(timestamp);
    const completedDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return completedDate === isoDate;
  }

  function isAbsoluteReminderDue(reminder, isoDate, hhmm) {
    if (!reminder || reminder.enabled === false || reminder.type !== 'absolute') return false;
    if (reminder.date && reminder.date !== isoDate) return false;
    return reminder.time === hhmm;
  }

  return { dayNumber, isIsoDate, shouldMapRangeTask, isTaskCompletedOn, isAbsoluteReminderDue };
}));
