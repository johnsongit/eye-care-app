const $ = (id) => document.getElementById(id);
let state = null;

const GREETINGS = [
  [5, '早上好，新的一天元气满满'],
  [9, '上午时光，记得多喝水'],
  [12, '午间时光，闭目养神一会儿'],
  [14, '午后时光，起来活动活动'],
  [18, '傍晚时分，远眺放松一下眼睛'],
  [21, '夜深了，注意用眼早点休息'],
];

function greeting() {
  const h = new Date().getHours();
  let text = GREETINGS[GREETINGS.length - 1][1];
  for (const [start, t] of GREETINGS) if (h >= start) text = t;
  if (h < 5) text = '夜深了，注意用眼早点休息';
  $('greeting').textContent = text;
}

function update(patch) {
  window.api.update(patch).then(render);
}

function setToggle(id, on) { $(id).classList.toggle('on', !!on); }
function setCheck(id, on) { $(id).classList.toggle('on', !!on); }
function setRadios(id, value, disabled) {
  for (const r of $(id).querySelectorAll('.radio')) {
    r.classList.toggle('on', r.dataset.v === String(value));
    r.classList.toggle('dis', !!disabled);
  }
}
function setPicker(id, text, disabled, placeholder) {
  const el = $(id);
  const txt = el.querySelector('.txt');
  txt.textContent = text || placeholder;
  txt.classList.toggle('ph', !text);
  el.classList.toggle('dis', !!disabled);
}

function render(s) {
  state = s;
  const st = s.settings;
  setCheck('eyeExitFullscreen', st.eyeExitFullscreen);
  setToggle('blueLight', st.blueLight);
  [...$('bars').children].forEach((b, i) => b.classList.toggle('on', i < st.intensity));
  $('intensityRow').classList.toggle('disabled', !st.blueLight);
  setRadios('blueMode', st.blueMode, !st.blueLight);
  const range = st.blueStart && st.blueEnd ? `${st.blueStart} - ${st.blueEnd}` : '';
  setPicker('bluePicker', range, !st.blueLight || st.blueMode !== 'schedule', '请选择时间');
  setToggle('beanGreen', st.beanGreen);

  setCheck('alarmDnd', st.alarmDnd);
  setToggle('rest', st.rest);
  setRadios('restInterval', st.restInterval, !st.rest);
  $('rest').title = st.rest
    ? `已连续使用 ${s.status.usedMinutes} 分钟，约 ${s.status.nextRestMinutes} 分钟后提醒休息`
    : '';
  setToggle('shutdown', st.shutdown);
  setRadios('shutdownMode', st.shutdownMode, !st.shutdown);
  setPicker('shutdownPicker', st.shutdownTime, !st.shutdown, '请选择时间');
}

function bind() {
  const bars = $('bars');
  for (let i = 1; i <= 5; i++) {
    const b = document.createElement('span');
    b.className = 'bar';
    b.title = `${i} 档`;
    b.onclick = () => update({ intensity: i });
    bars.appendChild(b);
  }
  for (const id of ['blueLight', 'beanGreen', 'rest', 'shutdown', 'eyeExitFullscreen', 'alarmDnd']) {
    $(id).onclick = () => update({ [id]: !state.settings[id] });
  }
  const radioGroup = (id, cast) => {
    $(id).addEventListener('click', (e) => {
      const r = e.target.closest('.radio');
      if (!r || r.classList.contains('dis')) return;
      update({ [id]: cast(r.dataset.v) });
    });
  };
  radioGroup('blueMode', String);
  radioGroup('shutdownMode', String);
  radioGroup('restInterval', Number);

  $('btnMin').onclick = () => window.api.minimize();
  $('btnClose').onclick = () => window.api.close();
  $('btnHelp').onclick = () => $('helpMask').classList.add('show');
  $('btnPreview').onclick = () => $('previewMask').classList.add('show');
  $('btnEnableGreen').onclick = () => {
    update({ beanGreen: true });
    $('previewMask').classList.remove('show');
  };
  document.querySelectorAll('[data-close]').forEach((b) => {
    b.onclick = () => b.closest('.mask').classList.remove('show');
  });
  document.querySelectorAll('.mask').forEach((m) => {
    m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('show'); });
  });

  $('bluePicker').onclick = (e) => {
    e.stopPropagation();
    const st = state.settings;
    openPicker($('bluePicker'), [
      { title: '开始时间', value: st.blueStart || '19:00' },
      { title: '结束时间', value: st.blueEnd || '07:00' },
    ], ([start, end]) => update({ blueStart: start, blueEnd: end }));
  };
  $('shutdownPicker').onclick = (e) => {
    e.stopPropagation();
    openPicker($('shutdownPicker'), [{ title: '提醒时间', value: state.settings.shutdownTime || '19:00' }],
      ([t]) => update({ shutdownTime: t }));
  };
  document.addEventListener('click', (e) => {
    if (!$('popover').contains(e.target)) closePicker();
  });
}

function closePicker() {
  $('popover').classList.remove('show');
}

function openPicker(anchor, groups, onOk) {
  const pop = $('popover');
  const values = groups.map((g) => g.value.split(':').map(Number));
  pop.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'groups';
  groups.forEach((g, gi) => {
    const box = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'group-title';
    title.textContent = g.title;
    const cols = document.createElement('div');
    cols.className = 'cols';
    [24, 60].forEach((n, ci) => {
      const col = document.createElement('div');
      col.className = 'col';
      for (let v = 0; v < n; v++) {
        const cell = document.createElement('div');
        cell.className = 'cell' + (values[gi][ci] === v ? ' sel' : '');
        cell.textContent = String(v).padStart(2, '0');
        cell.onclick = () => {
          values[gi][ci] = v;
          col.querySelectorAll('.sel').forEach((c) => c.classList.remove('sel'));
          cell.classList.add('sel');
        };
        col.appendChild(cell);
      }
      cols.appendChild(col);
    });
    box.append(title, cols);
    wrap.appendChild(box);
  });
  const foot = document.createElement('div');
  foot.className = 'foot';
  const cancel = document.createElement('button');
  cancel.className = 'btn';
  cancel.textContent = '取消';
  cancel.onclick = closePicker;
  const ok = document.createElement('button');
  ok.className = 'btn primary';
  ok.textContent = '确定';
  ok.onclick = () => {
    closePicker();
    onOk(values.map(([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`));
  };
  foot.append(cancel, ok);
  pop.append(wrap, foot);
  pop.classList.add('show');

  const app = $('app').getBoundingClientRect();
  const a = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  let left = Math.min(a.left - app.left, app.width - w - 12);
  let top = a.bottom - app.top + 6;
  if (top + h > app.height - 8) top = a.top - app.top - h - 6;
  pop.style.left = `${Math.max(12, left)}px`;
  pop.style.top = `${Math.max(12, top)}px`;
  pop.querySelectorAll('.col').forEach((col) => {
    const sel = col.querySelector('.sel');
    if (sel) col.scrollTop = sel.offsetTop - 70;
  });
}

bind();
greeting();
setInterval(greeting, 60000);
window.api.getState().then(render);
window.api.onState(render);
