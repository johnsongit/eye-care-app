const $ = (id) => document.getElementById(id);
let timer = null;

function fmt(sec) {
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

function buttons(list) {
  $('btns').innerHTML = '';
  for (const [label, action, primary] of list) {
    const b = document.createElement('button');
    b.textContent = label;
    if (primary) b.className = 'primary';
    b.onclick = () => (typeof action === 'function' ? action() : window.api.reminderAction(action));
    $('btns').appendChild(b);
  }
}

function countdown(seconds, tickMs, onEnd) {
  clearInterval(timer);
  let left = seconds;
  $('count').hidden = false;
  $('count').textContent = fmt(left);
  timer = setInterval(() => {
    left -= 1;
    $('count').textContent = fmt(Math.max(0, left));
    if (left <= 0) { clearInterval(timer); onEnd(); }
  }, tickMs);
}

function show(d) {
  clearInterval(timer);
  $('count').hidden = true;
  if (d.type === 'rest') {
    $('title').textContent = '该休息一下了';
    $('text').textContent = `您已连续使用电脑 ${d.minutes >= 60 ? d.minutes / 60 + ' 小时' : d.minutes + ' 分钟'}，起身活动一下，看看远处放松眼睛吧～`;
    buttons([
      ['跳过', 'rest-skip'],
      ['5分钟后提醒', 'rest-snooze'],
      ['开始休息', () => startRest(d), true],
    ]);
  } else if (d.type === 'shutdown-remind') {
    $('title').textContent = '到点关机啦';
    $('text').textContent = `已到设定的关机时间 ${d.time}，请保存好工作内容，早点休息。`;
    buttons([
      ['取消', 'shutdown-cancel'],
      ['10分钟后提醒', 'shutdown-snooze'],
      ['立即关机', 'shutdown-now', true],
    ]);
  } else if (d.type === 'shutdown-auto') {
    $('title').textContent = '即将自动关机';
    $('text').textContent = `已到设定的关机时间 ${d.time}，电脑将在倒计时结束后关机，请尽快保存工作内容。`;
    buttons([['取消关机', 'shutdown-abort', true]]);
    countdown(d.seconds, 1000, () => {});
  }
}

function startRest(d) {
  window.api.reminderAction('rest-start');
  $('title').textContent = '休息中…';
  $('text').textContent = '闭上眼睛或眺望 6 米外的景物，转动脖子、伸个懒腰。';
  buttons([['结束休息', 'rest-done', true]]);
  countdown(d.restSeconds, Math.max(50, Math.round(1000 * d.minuteMs / 60000)), () => window.api.reminderAction('rest-done'));
}

window.api.onReminder(show);
