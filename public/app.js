const STATE = {
  currentUser: null,
  editingId: null,
  editingUserId: null,
  editingTeamMemberId: null,
  selectedDeviceCode: null,
  pagination: {
    directory: { page: 1, size: 50 },
    device: { page: 1, size: 50 }
  }
};

const STORE = {
  currentSupId: null,
  currentSupData: null,
  currentSupEntries: []
};

const REGION_LABELS = { South: 'الجنوب', West: 'الغرب', East: 'الشرق' };
const XLSX_COLUMNS = [
  ['registry_id', 'ID'], ['org_id', 'الرقم التنظيمي (المؤتمر)'], ['name', 'الاسم'], ['surname', 'اللقب'], ['age', 'العمر'],
  ['city', 'مدينة الإقامة'], ['origin_city', 'مدينة الأصل'], ['region', 'المنطقة'],
  ['tribe', 'القبيلة'], ['id_type', 'نوع الهوية'], ['id_number', 'رقم الهوية'], ['education', 'المؤهل العلمي '],
  ['phone', 'الهاتف'], ['phone2', 'هاتف إضافي'], ['notes', 'ملاحظات'], ['created_at', 'تاريخ التسجيل']
];
const REGION_AR_TO_EN = { 'الجنوب': 'South', 'الغرب': 'West', 'الشرق': 'East' };

function apiFetch(url, options = {}) {
  return fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...options });
}

async function apiJson(url, options = {}) {
  const res = await apiFetch(url, options);
  if (res.status === 401) {
    showLoginModal();
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error || 'Server error');
  }
  return res.json();
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML;
}

function hasPermission(permission) {
  if (!STATE.currentUser) return false;
  if (STATE.currentUser.role === 'super_admin') return true;
  return String(STATE.currentUser.permissions || '').split(',').map(p => p.trim().toLowerCase()).includes(permission);
}

function canEdit() {
  if (!STATE.currentUser) return false;
  if (STATE.currentUser.role === 'super_admin' || STATE.currentUser.role === 'supervisor' || STATE.currentUser.role === 'manager') return true;
  return hasPermission('edit');
}

function canDelete() {
  if (!STATE.currentUser) return false;
  if (STATE.currentUser.role === 'super_admin' || STATE.currentUser.role === 'supervisor' || STATE.currentUser.role === 'manager') return true;
  return hasPermission('delete');
}

function updateUserSummary() {
  document.getElementById('currentUserName').textContent = STATE.currentUser ? `المستخدم: ${STATE.currentUser.username}` : 'غير مسجل';
  document.getElementById('currentUserRole').textContent = STATE.currentUser ? `الدور: ${getRoleLabel(STATE.currentUser.role)}` : 'الدور: -';
  document.getElementById('logoutBtn').style.display = STATE.currentUser ? 'block' : 'none';
}

function getRoleLabel(role) {
  if (role === 'super_admin') return 'مشرف فائق';
  if (role === 'supervisor') return 'مشرف';
  if (role === 'manager') return 'مدير';
  if (role === 'member') return 'عضو';
  return role || '-';
}

function showLoginModal() {
  document.getElementById('loginModal').classList.add('show');
  setTimeout(() => document.getElementById('loginUsername').focus(), 120);
}

function hideLoginModal() {
  document.getElementById('loginModal').classList.remove('show');
}

function showLoadingOverlay() {
  const fill = document.getElementById('loaderBarFill');
  fill.style.animation = 'none';
  void fill.offsetWidth; // restart the progress animation
  fill.style.animation = '';
  document.getElementById('loadingOverlay').classList.add('show');
}

function hideLoadingOverlay() {
  document.getElementById('loadingOverlay').classList.remove('show');
}

function setPageVisibility() {
  const usersNav = document.querySelector('.nav-item[data-page="users"]');
  usersNav.style.display = hasPermission('manage_users') || STATE.currentUser?.role === 'super_admin' ? 'flex' : 'none';
  const devicesNav = document.querySelector('.nav-item[data-page="devices"]');
  devicesNav.style.display = STATE.currentUser?.role === 'super_admin' ? 'flex' : 'none';
  const citiesNav = document.querySelector('.nav-item[data-page="cities"]');
  if (citiesNav) citiesNav.style.display = STATE.currentUser?.role === 'super_admin' ? 'flex' : 'none';
  const tribesNav = document.querySelector('.nav-item[data-page="tribes"]');
  if (tribesNav) tribesNav.style.display = STATE.currentUser?.role === 'super_admin' ? 'flex' : 'none';
  const ethnicitiesNav = document.querySelector('.nav-item[data-page="ethnicities"]');
  if (ethnicitiesNav) ethnicitiesNav.style.display = 'none';
  const supervisorsNav = document.querySelector('.nav-item[data-page="supervisors"]');
  if (supervisorsNav) supervisorsNav.style.display = STATE.currentUser?.role === 'super_admin' ? 'flex' : 'none';
  const myTeamNav = document.querySelector('.nav-item[data-page="my-team"]');
  if (myTeamNav) myTeamNav.style.display = STATE.currentUser?.role === 'supervisor' ? 'flex' : 'none';
  const addMemberNav = document.querySelector('.nav-item[data-page="add-member"]');
  if (addMemberNav) addMemberNav.style.display = STATE.currentUser?.role === 'supervisor' ? 'flex' : 'none';
  const mapNav = document.querySelector('.nav-item[data-page="map"]');
  if (mapNav) mapNav.style.display = (STATE.currentUser?.role === 'super_admin' || STATE.currentUser?.role === 'supervisor') ? 'flex' : 'none';
  document.getElementById('exportBtn').disabled = !hasPermission('export');
  document.getElementById('importBtn').disabled = !hasPermission('export');
}

function activatePage(page) {
  document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.page === page));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));
  if (page === 'directory') renderDirectory();
  if (page === 'devices') renderDevices();
  if (page === 'cities') renderCities();
  if (page === 'tribes') renderTribes();
  if (page === 'ethnicities') renderEthnicities();
  if (page === 'users') renderUsers();
  if (page === 'dashboard') renderDashboard();
  if (page === 'supervisors') renderSupervisorsPage();
  if (page === 'map') renderMapPage();
  if (page === 'my-team') renderMyTeamPage();
  if (page === 'add-member') renderAddMemberPage();
  if (page !== 'add' && STATE.editingId !== null) exitEditMode();
}

function initNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      if (!STATE.currentUser) {
        showLoginModal();
        return;
      }
      if (item.dataset.page === 'users' && !hasPermission('manage_users') && STATE.currentUser.role !== 'super_admin') {
        alert('غير مخول بمشاهدة هذه الصفحة.');
        return;
      }
      if ((item.dataset.page === 'cities' || item.dataset.page === 'tribes' || item.dataset.page === 'supervisors' || item.dataset.page === 'ethnicities') && STATE.currentUser.role !== 'super_admin') {
        alert('غير مخول بمشاهدة هذه الصفحة.');
        return;
      }
      if (item.dataset.page === 'my-team' && STATE.currentUser.role !== 'supervisor') {
        alert('غير مخول بمشاهدة هذه الصفحة.');
        return;
      }
      if (item.dataset.page === 'map' && STATE.currentUser.role !== 'super_admin' && STATE.currentUser.role !== 'supervisor') {
        alert('غير مخول بمشاهدة هذه الصفحة.');
        return;
      }
      if (item.dataset.page === 'add-member' && STATE.currentUser.role !== 'supervisor') {
        alert('غير مخول بمشاهدة هذه الصفحة.');
        return;
      }
      activatePage(item.dataset.page);
    });
  });
}

async function getCurrentUser() {
  try {
    const user = await apiJson('/api/me');
    STATE.currentUser = user;
    updateUserSummary();
    setPageVisibility();
    return user;
  } catch (err) {
    STATE.currentUser = null;
    updateUserSummary();
    setPageVisibility();
    showLoginModal();
    return null;
  }
}

async function login() {
  const identifier = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  if (!identifier || !password) {
    alert('الرجاء إدخال اسم المستخدم أو البريد وكلمة المرور.');
    return;
  }
  const btn = document.getElementById('loginBtn');
  btn.disabled = true;
  try {
    const user = await apiJson('/api/login', { method: 'POST', body: JSON.stringify({ identifier, password }) });
    STATE.currentUser = user;
    hideLoginModal();
    showLoadingOverlay();
    // Short branded pause so the system feels like it's loading.
    await new Promise(resolve => setTimeout(resolve, 7000));
    hideLoadingOverlay();
    updateUserSummary();
    setPageVisibility();
    renderAll();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
}

async function logout() {
  if (!confirm('هل أنت متأكد من تسجيل الخروج؟')) return;
  try {
    await apiJson('/api/logout', { method: 'POST' });
  } catch (e) { /* session may already be expired */ }
  STATE.currentUser = null;
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
  updateUserSummary();
  setPageVisibility();
  activatePage('dashboard');
  showLoginModal();
}

function resetPersonForm() {
  STATE.editingId = null;
  document.getElementById('f_name').value = '';
  document.getElementById('f_surname').value = '';
  document.getElementById('f_age').value = '';
  document.getElementById('f_region').value = '';
  document.getElementById('f_city').value = '';
  document.getElementById('f_origin_city').value = '';
  document.getElementById('f_tribe').value = '';
  document.getElementById('f_idtype').value = '';
  document.getElementById('f_idnum').value = '';
  document.getElementById('f_education').value = '';
  document.getElementById('f_notes').value = '';
  document.getElementById('f_phone').value = '';
  document.getElementById('f_phone2').value = '';
  document.getElementById('formTitle').textContent = 'إضافة شخص';
  document.getElementById('formSubtitle').textContent = 'أدخل بياناته ثم اضغط حفظ لتسجيله.';
  document.getElementById('saveBtn').textContent = 'حفظ الإدخال';
  document.getElementById('cancelEditBtn').style.display = 'none';
}

function enterEditMode(person) {
  STATE.editingId = person.id;
  document.getElementById('f_name').value = person.name || '';
  document.getElementById('f_surname').value = person.surname || '';
  document.getElementById('f_age').value = person.age || '';
  document.getElementById('f_region').value = person.region || '';
  document.getElementById('f_city').value = person.city || '';
  document.getElementById('f_origin_city').value = person.origin_city || '';
  document.getElementById('f_tribe').value = person.tribe || '';
  document.getElementById('f_idtype').value = person.id_type || '';
  document.getElementById('f_idnum').value = person.id_number || '';
  document.getElementById('f_education').value = person.education || '';
  document.getElementById('f_notes').value = person.notes || '';
  document.getElementById('f_phone').value = person.phone || '';
  document.getElementById('f_phone2').value = person.phone2 || '';
  document.getElementById('formTitle').textContent = `تعديل بيانات — ${person.name} ${person.surname || ''}`;
  document.getElementById('formSubtitle').textContent = 'عدّل الحقول ثم اضغط حفظ التعديلات.';
  document.getElementById('saveBtn').textContent = 'حفظ التعديلات';
  document.getElementById('cancelEditBtn').style.display = 'inline-block';
  document.querySelector('.nav-item[data-page="add"]').click();
}

function handleDetailModal(person) {
  STATE.currentDetailId = person.id;
  document.getElementById('detailName').textContent = `${person.name} ${person.surname || ''}`;
  const fields = [
    ['ID', person.registry_id || `#${String(person.id).padStart(4, '0')}`],
    ['الرقم التنظيمي', person.org_id || '—'],
    ['العمر', person.age ?? '—'],
    ['المنطقة', REGION_LABELS[person.region] || '—'],
    ['مدينة الإقامة', person.city || '—'],
    ['مدينة الأصل', person.origin_city || '—'],
    ['القبيلة', person.tribe || '—'],
    ['نوع الهوية', person.id_type || '—'],
    ['رقم الهوية', person.id_number || '—'],
    ['المؤهل العلمي ', person.education || '—'],
    ['الهاتف', person.phone || '—'],
    ['هاتف إضافي', person.phone2 || '—']
  ];
  const html = fields.map(([label, value]) => `<div class="detail-item"><div class="di-label">${label}</div><div class="di-val">${escapeHtml(String(value))}</div></div>`).join('');
  document.getElementById('detailGrid').innerHTML = html + (person.notes ? `<div class="detail-item full"><div class="di-label">ملاحظات</div><div class="di-val">${escapeHtml(person.notes)}</div></div>` : '');
  document.getElementById('detailEdit').style.display = canEdit() ? 'inline-flex' : 'none';
  document.getElementById('detailDelete').style.display = canDelete() ? 'inline-flex' : 'none';
  document.getElementById('detailModal').classList.add('show');
}

async function createOrUpdatePerson() {
  if (!canEdit()) {
    alert('غير مخول بإضافة أو تعديل السجلات.');
    return;
  }
  const data = {
    name: document.getElementById('f_name').value.trim(),
    surname: document.getElementById('f_surname').value.trim(),
    age: document.getElementById('f_age').value || null,
    city: document.getElementById('f_city').value.trim(),
    origin_city: document.getElementById('f_origin_city').value.trim(),
    region: document.getElementById('f_region').value,
    tribe: document.getElementById('f_tribe').value.trim(),
    id_type: document.getElementById('f_idtype').value,
    id_number: document.getElementById('f_idnum').value.trim(),
    education: document.getElementById('f_education').value.trim(),
    notes: document.getElementById('f_notes').value.trim(),
    phone: document.getElementById('f_phone').value.trim(),
    phone2: document.getElementById('f_phone2').value.trim()
  };
  if (!data.name) {
    alert('الرجاء إدخال الاسم.');
    return;
  }
  if (!data.surname) {
    alert('الرجاء إدخال اللقب.');
    return;
  }
  if (!data.age) {
    alert('الرجاء إدخال العمر.');
    return;
  }
  if (!data.region) {
    alert('الرجاء اختيار المنطقة.');
    return;
  }
  if (!data.city) {
    alert('الرجاء إدخال مدينة الإقامة.');
    return;
  }
  if (!data.origin_city) {
    alert('الرجاء إدخال مدينة الأصل.');
    return;
  }
  
  if (!data.tribe) {
    alert('الرجاء إدخال القبيلة.');
    return;
  }
  if (!data.id_type) {
    alert('الرجاء اختيار نوع الهوية.');
    return;
  }
  if (!data.id_number) {
    alert('الرجاء إدخال رقم الهوية.');
    return;
  }
  if (!data.education) {
    alert('الرجاء إدخال المؤهل العلمي .');
    return;
  }
  if (!data.phone) {
    alert('الرجاء إدخال رقم الهاتف.');
    return;
  }
  try {
    if (STATE.editingId) {
      await apiJson(`/api/people/${STATE.editingId}`, { method: 'PUT', body: JSON.stringify(data) });
      showFlash('saveFlash', `&#10003; تم حفظ التعديلات على — ${escapeHtml(data.name)} ${escapeHtml(data.surname)}`);
      resetPersonForm();
    } else {
      const person = await apiJson('/api/people', { method: 'POST', body: JSON.stringify(data) });
      showFlash('saveFlash', `&#10003; تم التسجيل برقم <strong>${escapeHtml(person.registry_id)}</strong> — المؤتمر: <strong>${escapeHtml(person.org_id)}</strong> — ${escapeHtml(person.name)} ${escapeHtml(person.surname)}`);
      resetPersonForm();
    }
    renderDashboard();
    renderDirectory();
    renderDevices();
  } catch (err) {
    alert(err.message);
  }
}

function showFlash(id, message) {
  const flash = document.getElementById(id);
  flash.innerHTML = message;
  flash.classList.add('show');
  setTimeout(() => flash.classList.remove('show'), 3200);
}

function clearPersonForm() {
  resetPersonForm();
}

async function renderDashboard() {
  const people = await apiJson('/api/people');
  document.getElementById('totalCount').textContent = people.length;
  document.getElementById('stampDate').textContent = 'آخر تحديث ' + new Date().toLocaleString('ar-LY');
  const regions = { South: 0, West: 0, East: 0 };
  people.forEach(p => { if (regions[p.region] !== undefined) regions[p.region]++; });
  document.getElementById('countSouth').textContent = regions.South;
  document.getElementById('countWest').textContent = regions.West;
  document.getElementById('countEast').textContent = regions.East;
  const max = Math.max(1, regions.South, regions.West, regions.East);
  document.getElementById('barSouth').style.width = `${regions.South / max * 100}%`;
  document.getElementById('barWest').style.width = `${regions.West / max * 100}%`;
  document.getElementById('barEast').style.width = `${regions.East / max * 100}%`;
  const recentList = document.getElementById('recentList');
  const recent = people.slice(0, 6);
  if (!recent.length) {
    recentList.innerHTML = '<div class="empty-note">لا يوجد أحد مسجَّل بعد. أضف أول شخص للبدء.</div>';
    return;
  }
  recentList.innerHTML = recent.map(p => `
    <div class="recent-row">
      <div>
        <div class="rr-name">${escapeHtml(p.name)} ${escapeHtml(p.surname || '')}</div>
        <div class="rr-meta">${escapeHtml(p.city || '—')} &middot; ${escapeHtml(p.tribe || '—')}</div>
      </div>
      <span class="tag tag-${(p.region || '').toLowerCase()}">${REGION_LABELS[p.region] || '—'}</span>
    </div>`).join('');
}

function filterPeople(rows, query, field, region) {
  const q = String(query || '').trim().toLowerCase();
  return rows.filter(p => {
    const regionMatch = !region || p.region === region;
    if (!q) return regionMatch;
    if (field === 'name_surname') {
      return regionMatch && (String(p.name || '').toLowerCase().includes(q) || String(p.surname || '').toLowerCase().includes(q));
    }
    return regionMatch && String(p[field] || '').toLowerCase().includes(q);
  });
}

function paginate(rows, state) {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / state.size));
  state.page = Math.min(Math.max(1, state.page), pages);
  const start = (state.page - 1) * state.size;
  return { items: rows.slice(start, start + state.size), total, pages, start };
}

function renderPagination(containerId, state, total, label) {
  const el = document.getElementById(containerId);
  const pages = Math.max(1, Math.ceil(total / state.size));
  state.page = Math.min(Math.max(1, state.page), pages);
  const from = total ? ((state.page - 1) * state.size) + 1 : 0;
  const to = total ? Math.min(state.page * state.size, total) : 0;
  const maxButtons = 7;
  let pageStart = Math.max(1, state.page - 3);
  let pageEnd = Math.min(pages, pageStart + maxButtons - 1);
  pageStart = Math.max(1, pageEnd - maxButtons + 1);
  let buttons = `<button data-pg-action="prev" ${state.page === 1 ? 'disabled' : ''}>السابق</button>`;
  if (pageStart > 1) buttons += `<button data-pg-page="1">1</button>${pageStart > 2 ? '<span>…</span>' : ''}`;
  for (let p = pageStart; p <= pageEnd; p++) buttons += `<button data-pg-page="${p}" class="${p === state.page ? 'active' : ''}">${p}</button>`;
  if (pageEnd < pages) buttons += `${pageEnd < pages - 1 ? '<span>…</span>' : ''}<button data-pg-page="${pages}">${pages}</button>`;
  buttons += `<button data-pg-action="next" ${state.page === pages ? 'disabled' : ''}>التالي</button>`;
  el.innerHTML = `<div class="pagination-info">عرض ${from}–${to} من ${total} ${label}</div><div class="pagination-controls">${buttons}<select class="pagination-size" aria-label="عدد السجلات في الصفحة"><option value="25" ${state.size===25?'selected':''}>25</option><option value="50" ${state.size===50?'selected':''}>50</option><option value="100" ${state.size===100?'selected':''}>100</option><option value="250" ${state.size===250?'selected':''}>250</option></select></div>`;
  el.querySelectorAll('[data-pg-page]').forEach(btn => btn.addEventListener('click', () => { state.page = Number(btn.dataset.pgPage); state.render(); }));
  el.querySelector('[data-pg-action="prev"]')?.addEventListener('click', () => { if (state.page > 1) { state.page--; state.render(); } });
  el.querySelector('[data-pg-action="next"]')?.addEventListener('click', () => { if (state.page < pages) { state.page++; state.render(); } });
  const sizeSelect = el.querySelector('.pagination-size');
  if (sizeSelect) {
    sizeSelect.addEventListener('change', e => { state.size = Number(e.target.value); state.page = 1; state.render(); });
  }
}

function renderPersonRows(rows, bodyId) {
  const body = document.getElementById(bodyId);
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:30px; color:var(--text-dim);">لا توجد نتائج مطابقة.</td></tr>`;
    return;
  }
  const canEdit = hasPermission('edit');
  const canDelete = hasPermission('delete');
  body.innerHTML = rows.map(p => `
    <tr data-id="${p.id}">
      <td class="id-chip">${escapeHtml(p.registry_id || `#${String(p.id).padStart(4, '0')}`)}</td>
      <td>${escapeHtml(p.name)} ${escapeHtml(p.surname || '')}</td>
      <td>${p.age ?? '—'}</td>
      <td>${escapeHtml(p.city || '—')}</td>
      <td>${escapeHtml(p.origin_city || '—')}</td>
      <td><span class="tag tag-${(p.region || '').toLowerCase()}">${REGION_LABELS[p.region] || '—'}</span></td>
      <td>${escapeHtml(p.tribe || '—')}</td>
      <td>${escapeHtml(p.org_id || '—')}</td>
      <td class="row-actions">${canEdit ? `<button class="icon-btn edit" data-edit="${p.id}" title="تعديل">&#9998; تعديل</button>` : ''}${canDelete ? `<button class="icon-btn danger" data-del="${p.id}" title="حذف">&#10005; حذف</button>` : ''}</td>
    </tr>`).join('');
  body.querySelectorAll('tr[data-id]').forEach(row => row.addEventListener('click', e => {
    if (e.target.closest('[data-del]') || e.target.closest('[data-edit]')) return;
    openDetail(Number(row.dataset.id));
  }));
  body.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); confirmDelete(Number(btn.dataset.del)); }));
  body.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); editPerson(Number(btn.dataset.edit)); }));
}

async function renderDirectory() {
  const rows = await apiJson('/api/people');
  let filtered = filterPeople(rows, document.getElementById('searchInput').value, document.getElementById('searchField').value, document.getElementById('regionFilter').value);
  const orgIdQ = document.getElementById('orgIdSearch').value.trim().toLowerCase();
  if (orgIdQ) {
    filtered = filtered.filter(p => {
      const num = String(p.org_id || '').slice(-5);
      return num === orgIdQ || p.org_id === orgIdQ;
    });
  }
  const state = STATE.pagination.directory;
  state.render = () => renderDirectory();
  const page = paginate(filtered, state);
  renderPersonRows(page.items, 'directoryBody');
  renderPagination('directoryPagination', state, page.total, 'سجل');
}

function editPerson(id) {
  apiJson(`/api/people`).then(rows => {
    const person = rows.find(p => p.id === id);
    if (person) enterEditMode(person);
  }).catch(() => {});
}

function openDetail(id) {
  apiJson(`/api/people`).then(rows => {
    const person = rows.find(p => p.id === id);
    if (person) handleDetailModal(person);
  }).catch(() => {});
}

function confirmDelete(id) {
  STATE.pendingDeleteId = id;
  document.getElementById('confirmModal').classList.add('show');
}

async function deletePerson() {
  if (!hasPermission('delete')) {
    alert('غير مخول بحذف السجلات.');
    return;
  }
  if (!STATE.pendingDeleteId) return;
  await apiJson(`/api/people/${STATE.pendingDeleteId}`, { method: 'DELETE' });
  STATE.pendingDeleteId = null;
  document.getElementById('confirmModal').classList.remove('show');
  renderDirectory();
  renderDashboard();
  renderDevices();
}

async function renderDevices() {
  if (STATE.currentUser?.role !== 'super_admin') {
    document.getElementById('deviceList').innerHTML = '<div class="empty-device">لا يوجد صلاحيات لعرض هذه الصفحة.</div>';
    document.getElementById('deviceSelectedHeader').innerHTML = '';
    document.getElementById('deviceDirectoryBody').innerHTML = '';
    return;
  }
  const devices = await apiJson('/api/devices');
  const list = document.getElementById('deviceList');
  if (!devices.length) {
    STATE.selectedDeviceCode = null;
    list.innerHTML = '<div class="empty-device">لا توجد أجهزة/أعضاء معرّفة بعد.</div>';
    document.getElementById('deviceSelectedHeader').innerHTML = '';
    document.getElementById('deviceDirectoryBody').innerHTML = '';
    return;
  }
  if (!STATE.selectedDeviceCode || !devices.some(d => d.device_name === STATE.selectedDeviceCode)) {
    STATE.selectedDeviceCode = devices[0].device_name;
  }
  list.innerHTML = devices.map(d => {
    const regionLabel = REGION_LABELS[d.region] || '';
    const supLabel = d.supervisor_name ? `تحت: ${escapeHtml(d.supervisor_name)}` : '';
    const extraInfo = regionLabel ? [regionLabel, supLabel].filter(Boolean).join(' · ') : supLabel;
    return `<button class="device-card ${d.device_name === STATE.selectedDeviceCode ? 'active' : ''}" data-device="${escapeHtml(d.device_name)}">
      <div style="display:flex; flex-direction:column; gap:2px; min-width:0; flex:1; text-align:right;">
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <span class="device-code">${escapeHtml(d.device_name)}</span>
          <span style="font-size:12px; color:var(--text-dim); font-weight:400;">${escapeHtml(d.username)}</span>
        </div>
        ${extraInfo ? `<span style="font-size:11px; color:var(--text-dim); opacity:0.7;">${extraInfo}</span>` : ''}
      </div>
      <span class="device-count">${d.count} سجل</span>
    </button>`;
  }).join('');
  list.querySelectorAll('[data-device]').forEach(btn => btn.addEventListener('click', () => {
    STATE.selectedDeviceCode = btn.dataset.device;
    document.getElementById('deviceSearchInput').value = '';
    document.getElementById('deviceSearchField').value = 'name_surname';
    document.getElementById('deviceRegionFilter').value = '';
    renderDevices();
  }));
  await renderDeviceRecords();
}

async function renderDeviceRecords() {
  const rows = await apiJson('/api/people?createdBy=' + encodeURIComponent(STATE.selectedDeviceCode || ''));
  const header = document.getElementById('deviceSelectedHeader');
  const input = document.getElementById('deviceSearchInput');
  const field = document.getElementById('deviceSearchField');
  const region = document.getElementById('deviceRegionFilter');
  const state = STATE.pagination.device;
  state.render = () => renderDeviceRecords();
  if (!STATE.selectedDeviceCode) {
    header.textContent = 'اختر جهازاً لعرض سجلاته';
    input.disabled = field.disabled = region.disabled = true;
    document.getElementById('deviceDirectoryBody').innerHTML = '';
    renderPagination('devicePagination', state, 0, 'سجل');
    return;
  }
  input.disabled = field.disabled = region.disabled = false;
  header.textContent = `سجلات الجهاز: ${STATE.selectedDeviceCode} — ${rows.length} سجل`;
  const filtered = filterPeople(rows, input.value, field.value, region.value);
  const page = paginate(filtered, state);
  renderPersonRows(page.items, 'deviceDirectoryBody');
  renderPagination('devicePagination', state, page.total, 'سجل');
}

async function renderCities() {
  const cities = await apiJson('/api/cities');
  const wrap = document.getElementById('cityListAll');
  if (!cities.length) {
    wrap.innerHTML = '<div class="empty-note" style="width:100%;">لا توجد مدن بعد. أضف واحدة أعلاه لتظهر في القائمة المنسدلة.</div>';
    return;
  }
  wrap.innerHTML = cities.map(city => `
    <div class="city-pill ${city.auto_added ? 'auto' : ''}">
      <span>${escapeHtml(city.name)}</span>
      <span class="cp-region">${REGION_LABELS[city.region] || city.region || '—'}</span>
      ${city.auto_added ? '<span class="cp-auto-tag">أُضيفت تلقائياً</span>' : ''}
      <button data-cid="${city.id}" title="إزالة المدينة">&#10005;</button>
    </div>`).join('');
  wrap.querySelectorAll('[data-cid]').forEach(btn => btn.addEventListener('click', async () => {
    await apiJson(`/api/cities/${btn.dataset.cid}`, { method: 'DELETE' });
    renderCities();
  }));
}

async function addCity() {
  const name = document.getElementById('newCityName').value.trim();
  const region = document.getElementById('newCityRegion').value;
  if (!name || !region) return;
  try {
    await apiJson('/api/cities', { method: 'POST', body: JSON.stringify({ name, region, auto_added: 0 }) });
    document.getElementById('newCityName').value = '';
    document.getElementById('newCityRegion').value = '';
    renderCities();
  } catch (err) {
    alert(err.message);
  }
}

async function renderTribes() {
  const tribes = await apiJson('/api/tribes');
  const wrap = document.getElementById('tribeListAll');
  if (!tribes.length) {
    wrap.innerHTML = '<div class="empty-note" style="width:100%;">لا توجد قبائل بعد. أضف واحدة أعلاه لتظهر في القائمة المنسدلة.</div>';
    return;
  }
  wrap.innerHTML = tribes.map(t => `
    <div class="city-pill ${t.auto_added ? 'auto' : ''}">
      <span>${escapeHtml(t.name)}</span>
      ${t.auto_added ? '<span class="cp-auto-tag">أُضيفت تلقائياً</span>' : ''}
      <button data-tid="${t.id}" title="إزالة القبيلة">&#10005;</button>
    </div>`).join('');
  wrap.querySelectorAll('[data-tid]').forEach(btn => btn.addEventListener('click', async () => {
    await apiJson(`/api/tribes/${btn.dataset.tid}`, { method: 'DELETE' });
    renderTribes();
  }));
}

async function addTribe() {
  const name = document.getElementById('newTribeName').value.trim();
  if (!name) return;
  try {
    await apiJson('/api/tribes', { method: 'POST', body: JSON.stringify({ name }) });
    document.getElementById('newTribeName').value = '';
    renderTribes();
  } catch (err) {
    alert(err.message);
  }
}

async function renderEthnicities() {
  const ethnicities = await apiJson('/api/ethnicities');
  const wrap = document.getElementById('ethnicityListAll');
  if (!ethnicities.length) {
    wrap.innerHTML = '<div class="empty-note" style="width:100%;">لا توجد أعراق بعد. أضف واحداً أعلاه لتظهر في القائمة المنسدلة.</div>';
    return;
  }
  wrap.innerHTML = ethnicities.map(e => `
    <div class="city-pill">
      <span>${escapeHtml(e.name)}</span>
      <button data-eid="${e.id}" title="إزالة العرق">&#10005;</button>
    </div>`).join('');
  wrap.querySelectorAll('[data-eid]').forEach(btn => btn.addEventListener('click', async () => {
    await apiJson(`/api/ethnicities/${btn.dataset.eid}`, { method: 'DELETE' });
    renderEthnicities();
    loadEthnicityDropdowns();
  }));
}

async function addEthnicity() {
  const name = document.getElementById('newEthnicityName').value.trim();
  if (!name) return;
  try {
    await apiJson('/api/ethnicities', { method: 'POST', body: JSON.stringify({ name }) });
    document.getElementById('newEthnicityName').value = '';
    renderEthnicities();
    loadEthnicityDropdowns();
  } catch (err) {
    alert(err.message);
  }
}

async function loadEthnicityDropdowns() {
  // Ethnicity has been hidden from the system
}

// ==================== Supervisors Page (super_admin only) ====================
async function renderSupervisorsPage() {
  if (STATE.currentUser?.role !== 'super_admin') {
    document.getElementById('supervisorsList').innerHTML = '<div class="empty-device">لا يوجد صلاحيات لعرض هذه الصفحة.</div>';
    return;
  }
  // Reset to list view and clear stale cache
  document.getElementById('supervisorsList').style.display = 'flex';
  document.getElementById('supervisorDetail').style.display = 'none';
  STORE.currentSupEntries = [];
  try {
    const supervisors = await apiJson('/api/supervisors');
    const container = document.getElementById('supervisorsList');
    container.innerHTML = supervisors.map(sup => `
      <div class="device-card" style="cursor:pointer; padding:16px 20px; margin-bottom:10px;" data-sup-id="${sup.id}">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; width:100%;">
          <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
            <strong style="font-size:16px;">${escapeHtml(sup.username)}</strong>
            <span class="tag">${escapeHtml(sup.device_name)}</span>
            <span class="tag" style="background:var(--gold-dim); color:var(--ink);">${REGION_LABELS[sup.region] || sup.region || '—'}</span>
          </div>
          <div style="display:flex; align-items:center; gap:16px; flex-wrap:wrap;">
            <span style="font-size:13px; color:var(--text-dim);">الفريق: <strong>${sup.team_member_count}</strong></span>
            <span style="font-size:13px; color:var(--text-dim);">التسجيلات: <strong>${sup.total_entries}</strong></span>
          </div>
        </div>
      </div>
    `).join('') || '<div class="empty-device">لا يوجد مشرفون بعد.</div>';

    container.querySelectorAll('.device-card[data-sup-id]').forEach(card => {
      card.addEventListener('click', async () => {
        await renderSupervisorDetail(card.dataset.supId);
      });
    });
  } catch (err) {
    console.error(err);
  }
}

async function renderSupervisorDetail(supId) {
  try {
    const data = await apiJson('/api/supervisors/' + supId + '/team');
    STORE.currentSupId = supId;
    STORE.currentSupData = data;

    // Back button
    const title = document.getElementById('supervisorDetailTitle');
    title.innerHTML = '&#8593; العودة إلى قائمة المشرفين';
    title.onclick = () => {
      document.getElementById('supervisorDetail').style.display = 'none';
      document.getElementById('supervisorsList').style.display = 'flex';
    };
    document.getElementById('supervisorsList').style.display = 'none';
    document.getElementById('supervisorDetail').style.display = 'block';

    // Team info card
    const sup = data.supervisor;
    const infoHtml = `
      <div class="device-card" style="padding:16px 20px; margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; width:100%;">
          <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
            <strong style="font-size:16px;">${escapeHtml(sup.username)}</strong>
            <span class="tag">${escapeHtml(sup.device_name)}</span>
            <span class="tag" style="background:var(--gold-dim); color:var(--ink);">${REGION_LABELS[sup.region] || sup.region || '—'}</span>
          </div>
          <div style="display:flex; align-items:center; gap:16px; flex-wrap:wrap;">
            <span style="font-size:13px; color:var(--text-dim);">تسجيلات المشرف: <strong>${sup.entry_count}</strong></span>
            <span style="font-size:13px; color:var(--text-dim);">أعضاء الفريق: <strong>${data.members.length}</strong></span>
            <span style="font-size:13px; color:var(--text-dim);">إجمالي تسجيلات الفريق: <strong>${data.total_entries}</strong></span>
            <button class="btn btn-primary btn-small" id="refreshSupEntries" title="تحديث">⟳ تحديث</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('supervisorTeamInfo').innerHTML = infoHtml;

    // Build the team member filter dropdown
    const filterSelect = document.getElementById('teamMemberFilter');
    filterSelect.innerHTML = '<option value="__all__">كل الفريق — جميع التسجيلات</option>';
    filterSelect.innerHTML += `<option value="${escapeHtml(sup.device_name)}">${escapeHtml(sup.username)} (المشرف) — ${sup.entry_count}</option>`;
    data.members.forEach(m => {
      filterSelect.innerHTML += `<option value="${escapeHtml(m.device_name)}">${escapeHtml(m.username)} — ${m.entry_count}</option>`;
    });

    // Fetch all entries for this supervisor's team
    await refreshTeamEntries();

    // Add event listeners for filter, search, and refresh
    filterSelect.onchange = () => { renderTeamEntriesTable(); };
    document.getElementById('teamSearchInput').oninput = () => { renderTeamEntriesTable(); };
    document.getElementById('teamSearchField').onchange = () => { renderTeamEntriesTable(); };
    document.getElementById('refreshSupEntries').onclick = async () => {
      await refreshTeamEntries();
    };

  } catch (err) {
    console.error(err);
    alert('حدث خطأ: ' + err.message);
  }
}

async function refreshTeamEntries() {
  const supId = STORE.currentSupId;
  if (!supId) return;
  const entries = await apiJson('/api/supervisors/' + supId + '/entries');
  STORE.currentSupEntries = entries;
  renderTeamEntriesTable();
}

function renderTeamEntriesTable() {
  const filter = document.getElementById('teamMemberFilter').value;
  const query = document.getElementById('teamSearchInput').value.trim().toLowerCase();
  const field = document.getElementById('teamSearchField').value;
  const entries = STORE.currentSupEntries || [];
  const container = document.getElementById('supervisorTeamEntries');

  // Filter by team member
  let filtered = entries;
  if (filter !== '__all__') {
    filtered = filtered.filter(p => String(p.created_by || '').trim() === filter);
  }

  // Filter by search query
  if (query) {
    filtered = filtered.filter(p => {
      const q = query;
      if (field === 'name_surname') {
        return String(p.name || '').toLowerCase().includes(q) || String(p.surname || '').toLowerCase().includes(q);
      }
      return String(p[field] || '').toLowerCase().includes(q);
    });
  }

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-device" style="padding:40px; text-align:center;">لا توجد تسجيلات مطابقة.</div>';
    return;
  }

  let html = `<div style="font-size:13px; color:var(--text-dim); margin-bottom:12px;">إجمالي: <strong>${filtered.length}</strong> تسجيلاً</div>`;
  html += `<table>
    <thead>
      <tr>
        <th>ID</th><th>الاسم</th><th>اللقب</th><th>العمر</th><th>مدينة الإقامة</th><th>مدينة الأصل</th><th>المنطقة</th><th>القبيلة</th><th>الجهاز</th><th></th>
      </tr>
    </thead>
    <tbody>
  `;
  filtered.forEach(p => {
    const regionLabel = REGION_LABELS[p.region] || p.region || '—';
    html += `<tr>
      <td>${escapeHtml(p.registry_id || '')}</td>
      <td>${escapeHtml(p.name || '')}</td>
      <td>${escapeHtml(p.surname || '')}</td>
      <td>${p.age || '—'}</td>
      <td>${escapeHtml(p.city || '')}</td>
      <td>${escapeHtml(p.origin_city || '')}</td>
      <td>${regionLabel}</td>
      <td>${escapeHtml(p.tribe || '')}</td>
      <td><span class="tag">${escapeHtml(p.created_by || '')}</span></td>
      <td><button class="btn btn-ghost btn-small" onclick="viewPersonDetail(${p.id})">عرض</button></td>
    </tr>`;
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

// ==================== My Team Page (supervisor only) ====================
async function renderMyTeamPage() {
  if (STATE.currentUser?.role !== 'supervisor') {
    document.getElementById('myTeamSummary').innerHTML = '<div class="empty-device">لا يوجد صلاحيات لعرض هذه الصفحة.</div>';
    return;
  }
  try {
    const data = await apiJson('/api/my-team');
    const sup = data.supervisor;
    const summaryHtml = `
      <div class="total-card" style="margin-bottom:20px;">
        <div class="total-wrap" style="gap:16px;">
          <div>
            <div class="total-num" style="font-size:32px;">${data.total_entries}</div>
            <div class="total-label">إجمالي تسجيلات الفريق</div>
          </div>
          <div style="border-right:1px solid rgba(255,255,255,0.2); padding-right:16px;">
            <div style="font-size:14px; color:#C9D0D6;">المشرف: <strong>${escapeHtml(sup.username)}</strong></div>
            <div style="font-size:14px; color:#C9D0D6;">الجهاز: <strong>${escapeHtml(sup.device_name)}</strong></div>
            <div style="font-size:14px; color:#C9D0D6;">المنطقة: <strong>${REGION_LABELS[sup.region] || sup.region}</strong></div>
            <div style="font-size:14px; color:#C9D0D6;">تسجيلاتي: <strong>${sup.entry_count}</strong></div>
          </div>
        </div>
      </div>
    `;
    document.getElementById('myTeamSummary').innerHTML = summaryHtml;

    const membersHtml = data.members.length > 0 ? data.members.map(m => `
      <div class="device-card" style="margin-bottom:8px; cursor:pointer;" data-member-device="${escapeHtml(m.device_name)}" data-member-username="${escapeHtml(m.username)}">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; width:100%;">
          <div><strong>${escapeHtml(m.username)}</strong> <span class="tag">${escapeHtml(m.device_name)}</span></div>
          <div style="font-size:13px; color:var(--text-dim);">التسجيلات: <strong>${m.entry_count}</strong></div>
        </div>
      </div>
      <div class="member-entries" data-member="${escapeHtml(m.device_name)}" style="display:none; margin-bottom:12px;"></div>
    `).join('') : '<div class="empty-device">لم تقم بإضافة أعضاء بعد.</div>';
    document.getElementById('myTeamMembers').innerHTML = membersHtml;

    // Add click handlers to member cards
    document.querySelectorAll('.device-card[data-member-device]').forEach(card => {
      card.addEventListener('click', async function() {
        const device = this.dataset.memberDevice;
        const username = this.dataset.memberUsername;
        const entriesDiv = document.querySelector(`.member-entries[data-member="${device}"]`);
        if (!entriesDiv) return;

        // Toggle visibility
        if (entriesDiv.style.display === 'block') {
          entriesDiv.style.display = 'none';
          return;
        }

        // Fetch and show entries
        entriesDiv.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-dim);">جارٍ التحميل...</div>';
        entriesDiv.style.display = 'block';
        try {
          const entries = await apiJson('/api/people?createdBy=' + encodeURIComponent(device));
          if (entries.length === 0) {
            entriesDiv.innerHTML = '<div class="empty-device" style="padding:16px;">لا توجد تسجيلات.</div>';
            return;
          }
          let html = `<div style="font-size:13px; color:var(--text-dim); margin-bottom:8px;">تسجيلات <strong>${escapeHtml(username)}</strong> — ${entries.length} سجل</div>`;
          html += '<table><thead><tr><th>الرقم</th><th>الاسم</th><th>اللقب</th><th>العمر</th><th>المدينة</th><th>المنطقة</th></tr></thead><tbody>';
          entries.forEach(p => {
            html += `<tr><td>${escapeHtml(p.registry_id || '')}</td><td>${escapeHtml(p.name || '')}</td><td>${escapeHtml(p.surname || '')}</td><td>${p.age || '—'}</td><td>${escapeHtml(p.city || '')}</td><td>${REGION_LABELS[p.region] || p.region || '—'}</td></tr>`;
          });
          html += '</tbody></table>';
          entriesDiv.innerHTML = html;
        } catch (err) {
          entriesDiv.innerHTML = '<div class="empty-device" style="padding:16px;">حدث خطأ في تحميل التسجيلات.</div>';
        }
      });
    });
  } catch (err) {
    console.error(err);
  }
}

// ==================== Add Member Page (supervisor only) ====================
async function renderAddMemberPage() {
  // The form is already in the HTML
  // Clear any editing state
  STATE.editingTeamMemberId = null;
  document.getElementById('addTeamMemberBtn').textContent = 'إضافة عضو';

  // Fetch team members
  try {
    const data = await apiJson('/api/my-team');
    const container = document.getElementById('addMemberTable');
    if (!data.members || data.members.length === 0) {
      container.innerHTML = '<div class="empty-device" style="margin-top:16px;">لا يوجد أعضاء في فريقك بعد.</div>';
      return;
    }
    let html = '<div class="section-label" style="margin-top:24px;">أعضاء فريقي</div>';
    html += '<table><thead><tr><th>اسم المستخدم</th><th>الجهاز</th><th>الاسم الكامل</th><th>الهاتف</th><th>التسجيلات</th><th>الحالة</th><th></th></tr></thead><tbody>';
    data.members.forEach(m => {
      const isActive = m.active !== 0;
      const statusBadge = isActive ? '' : ' <span class="tag" style="background:var(--clay-dim); color:var(--clay);">غير نشط</span>';
      html += `<tr>
        <td>${escapeHtml(m.username)}${statusBadge}</td>
        <td><span class="tag">${escapeHtml(m.device_name)}</span></td>
        <td>${escapeHtml(m.full_name || '')}</td>
        <td>${escapeHtml(m.phone || '')}</td>
        <td>${m.entry_count || 0}</td>
        <td>${isActive ? '<span style="color:var(--green);">نشط</span>' : '<span style="color:var(--clay);">غير نشط</span>'}</td>
        <td class="row-actions">
          ${isActive ? `<button class="btn btn-ghost btn-small edit-member" data-id="${m.id}">تعديل</button>
          <button class="btn btn-danger btn-small deactivate-member" data-id="${m.id}" data-username="${escapeHtml(m.username)}">إلغاء تنشيط</button>` 
          : `<button class="btn btn-primary btn-small activate-member" data-id="${m.id}">تنشيط</button>`}
        </td>
      </tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;

    // Edit handlers
    container.querySelectorAll('.edit-member').forEach(btn => {
      btn.addEventListener('click', async function() {
        const id = parseInt(this.dataset.id);
        const member = data.members.find(m => m.id === id);
        if (!member) return;
        STATE.editingTeamMemberId = id;
        document.getElementById('addTeamMemberBtn').textContent = 'حفظ التعديلات';
        document.getElementById('mtUsername').value = member.username || '';
        document.getElementById('mtEmail').value = member.email || '';
        document.getElementById('mtPassword').value = '';
        document.getElementById('mtDeviceName').value = member.device_name || '';
        document.getElementById('mtFullName').value = member.full_name || '';
        document.getElementById('mtSurname').value = member.surname || '';
        document.getElementById('mtPhone').value = member.phone || '';
        document.getElementById('mtIdNumber').value = member.id_number || '';
        document.getElementById('mtIdType').value = member.id_type || '';
        document.getElementById('mtAge').value = member.age || '';
        document.getElementById('mtCity').value = member.city || '';
        document.getElementById('mtOriginCity').value = member.origin_city || '';
        document.getElementById('mtTribe').value = member.tribe || '';
        document.getElementById('mtEducation').value = member.education || '';
        document.getElementById('mtNotes').value = member.notes || '';
        document.getElementById('mtSaveFlash').textContent = 'جارٍ تعديل: ' + member.username;
        document.getElementById('mtSaveFlash').style.color = 'var(--gold)';
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    // Deactivate handlers
    container.querySelectorAll('.deactivate-member').forEach(btn => {
      btn.addEventListener('click', async function() {
        const id = parseInt(this.dataset.id);
        const username = this.dataset.username;
        if (!confirm('إلغاء تنشيط العضو "' + username + '"؟ سيتم تعطيل حسابه ولن يتمكن من تسجيل الدخول، لكن سجلاته ستبقى.')) return;
        try {
          await apiJson('/api/my-team/' + id, { method: 'DELETE' });
          renderAddMemberPage();
        } catch (err) {
          alert(err.message);
        }
      });
    });

    // Activate handlers
    container.querySelectorAll('.activate-member').forEach(btn => {
      btn.addEventListener('click', async function() {
        const id = parseInt(this.dataset.id);
        try {
          await apiJson('/api/my-team/' + id + '/activate', { method: 'PUT' });
          renderAddMemberPage();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  } catch (err) {
    console.error(err);
  }
}
// ==================== Map Page ====================
async function renderMapPage() {
  const container = document.getElementById('mapContainer');
  if (STATE.currentUser?.role !== 'super_admin' && STATE.currentUser?.role !== 'supervisor') {
    container.innerHTML = '<div class="empty-device">لا يوجد صلاحيات لعرض هذه الصفحة.</div>';
    return;
  }

  container.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-dim);">جارٍ تحميل الخريطة...</div>';

  try {
    let allSupervisors = [];
    let myTeamData = null;

    if (STATE.currentUser.role === 'super_admin') {
      // Fetch all supervisors
      allSupervisors = await apiJson('/api/supervisors');
    } else if (STATE.currentUser.role === 'supervisor') {
      // Fetch my team only
      myTeamData = await apiJson('/api/my-team');
    }

    let html = '';

    if (STATE.currentUser.role === 'super_admin') {
      // Group by region
      const regions = ['West', 'East', 'South'];
      regions.forEach(region => {
        const supsInRegion = allSupervisors.filter(s => s.region === region);
        if (supsInRegion.length === 0) return;

        html += `<div class="map-region">
          <div class="map-region-header">
            <span class="map-region-icon">${region === 'West' ? '🌅' : region === 'East' ? '🌄' : '🏜️'}</span>
            <span>${REGION_LABELS[region]}</span>
          </div>
          <div class="map-team-grid">`;

        supsInRegion.forEach(async (sup, index) => {
          // Fetch team details for each supervisor
          // We'll use a sequential approach
        });
      });
    }

    // Use a different approach - fetch all teams data first
    container.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-dim);">جارٍ تحميل الخريطة...</div>';

    if (STATE.currentUser.role === 'super_admin') {
      // Build map: fetch each supervisor's team
      let mapHtml = '';
      const regions = ['West', 'East', 'South'];

      for (const region of regions) {
        const supsInRegion = allSupervisors.filter(s => s.region === region);
        if (supsInRegion.length === 0) continue;

        mapHtml += `<div class="map-region">
          <div class="map-region-header">
            <span class="map-region-icon">${region === 'West' ? '🌅' : region === 'East' ? '🌄' : '🏜️'}</span>
            <span>${REGION_LABELS[region]}</span>
          </div>
          <div class="map-team-grid">`;

        for (const sup of supsInRegion) {
          let supTeam;
          try {
            supTeam = await apiJson('/api/supervisors/' + sup.id + '/team');
          } catch (e) {
            supTeam = { supervisor: sup, members: [], total_entries: 0 };
          }
          mapHtml += buildTeamCardHtml(supTeam);
        }

        mapHtml += '</div></div>';
      }
      html = mapHtml;
    } else if (STATE.currentUser.role === 'supervisor' && myTeamData) {
      html = `<div class="map-region">
        <div class="map-region-header">
          <span class="map-region-icon">👥</span>
          <span>فريقي — ${REGION_LABELS[myTeamData.supervisor.region] || myTeamData.supervisor.region}</span>
        </div>
        <div class="map-team-grid">
          ${buildTeamCardHtml(myTeamData)}
        </div>
      </div>`;
    }

    container.innerHTML = html || '<div class="empty-device">لا توجد بيانات للعرض.</div>';

  } catch (err) {
    console.error(err);
    container.innerHTML = '<div class="empty-device">حدث خطأ أثناء تحميل الخريطة.</div>';
  }
}

function buildTeamCardHtml(teamData) {
  const sup = teamData.supervisor;
  if (!sup) return '';

  let html = `<div class="map-team-card">
    <div class="map-supervisor">
      <div class="map-avatar map-avatar-sup">${escapeHtml(sup.username.charAt(0).toUpperCase())}</div>
      <div class="map-person-info">
        <div class="map-person-name">${escapeHtml(sup.full_name || sup.username)}</div>
        <div class="map-person-detail">@${escapeHtml(sup.username)} • ${escapeHtml(sup.device_name)} • مشرف</div>
        ${sup.region ? `<div class="map-person-detail">المنطقة: ${REGION_LABELS[sup.region] || sup.region}</div>` : ''}
        ${sup.phone ? `<div class="map-person-detail">${escapeHtml(sup.phone)}</div>` : ''}
      </div>
      <button class="btn btn-ghost btn-small map-view-btn" onclick="showUserDetail(${sup.id})">عرض</button>
    </div>`;

  if (teamData.members && teamData.members.length > 0) {
    html += `<div class="map-connector"></div>
      <div class="map-members">`;
    teamData.members.forEach(m => {
      html += `<div class="map-member">
        <div class="map-avatar map-avatar-member">${escapeHtml(m.username.charAt(0).toUpperCase())}</div>
        <div class="map-person-info" style="text-align:center;">
          <div class="map-person-name" style="font-size:13px;">${escapeHtml(m.full_name || m.username)}</div>
          <div class="map-person-detail">@${escapeHtml(m.username)}</div>
          ${m.phone ? `<div class="map-person-detail" style="font-size:11px;">${escapeHtml(m.phone)}</div>` : ''}
        </div>
        <button class="btn btn-ghost btn-small map-view-btn" style="font-size:11px;" onclick="showUserDetail(${m.id})">عرض</button>
      </div>`;
    });
    html += '</div>';
  }

  html += '</div>';
  return html;
}

async function showUserDetail(userId) {
  try {
    const user = await apiJson('/api/user/' + userId);
    if (!user) { alert('المستخدم غير موجود.'); return; }

    const fields = [
      ['full_name', 'الاسم الكامل'], ['surname', 'اللقب'], ['username', 'اسم المستخدم'],
      ['device_name', 'الجهاز'], ['role', 'الدور'], ['region', 'المنطقة'],
      ['age', 'العمر'], ['phone', 'الهاتف'], ['email', 'البريد الإلكتروني'],
      ['id_type', 'نوع الهوية'], ['id_number', 'رقم الهوية'],
      ['city', 'مدينة الإقامة'], ['origin_city', 'مدينة الأصل'],
      ['tribe', 'القبيلة'], ['education', ' المؤهل العلمي'],
      ['notes', 'ملاحظات']
    ];

    const roleLabels = { 'super_admin': 'مشرف فائق', 'supervisor': 'مشرف', 'member': 'عضو فريق' };
    const regionLabels = { 'South': 'الجنوب', 'West': 'الغرب', 'East': 'الشرق' };

    let html = '<div class="modal" style="width:560px; max-height:85vh; overflow-y:auto;">';
    html += '<h3>' + escapeHtml(user.full_name || user.username) + '</h3>';
    html += '<div class="detail-grid">';
    fields.forEach(([key, label]) => {
      let val = user[key];
      if (val === undefined || val === null || String(val).trim() === '') return;
      if (key === 'role') val = roleLabels[val] || val;
      if (key === 'region') val = regionLabels[val] || val;
      html += `<div class="detail-item"><div class="di-label">${label}</div><div class="di-val">${escapeHtml(String(val))}</div></div>`;
    });
    html += '</div>';
    html += '<div class="modal-actions" style="margin-top:16px;"><button class="btn btn-ghost" onclick="this.closest(\'.modal-backdrop\').remove()">إغلاق</button></div>';
    html += '</div>';

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop show';
    backdrop.innerHTML = html;
    backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
  } catch (err) {
    alert(err.message);
  }
}

async function addTeamMember() {
  const username = document.getElementById('mtUsername').value.trim();
  const email = document.getElementById('mtEmail').value.trim();
  const password = document.getElementById('mtPassword').value;
  const device_name = document.getElementById('mtDeviceName').value.trim();
  const full_name = document.getElementById('mtFullName').value.trim();
  const surname = document.getElementById('mtSurname').value.trim();
  const phone = document.getElementById('mtPhone').value.trim();
  const id_number = document.getElementById('mtIdNumber').value.trim();
  const id_type = document.getElementById('mtIdType').value;
  const age = document.getElementById('mtAge').value || null;
  const city = document.getElementById('mtCity').value.trim();
  const origin_city = document.getElementById('mtOriginCity').value.trim();
  const tribe = document.getElementById('mtTribe').value.trim();
  const education = document.getElementById('mtEducation').value.trim();
  const notes = document.getElementById('mtNotes').value.trim();

  const isEditing = STATE.editingTeamMemberId;
  if (!isEditing && (!username || !email || !password || !device_name)) {
    document.getElementById('mtSaveFlash').textContent = 'جميع الحقول الأساسية مطلوبة.';
    document.getElementById('mtSaveFlash').style.color = 'var(--clay)';
    return;
  }

  const btn = document.getElementById('addTeamMemberBtn');
  btn.disabled = true;
  try {
    const payload = { username, email, password, device_name, full_name, surname, phone, id_number, id_type, age, city, origin_city, tribe, education, notes };
    if (isEditing) {
      await apiJson('/api/my-team/' + isEditing, { method: 'PUT', body: JSON.stringify(payload) });
      document.getElementById('mtSaveFlash').textContent = '✓ تم حفظ التعديلات!';
    } else {
      await apiJson('/api/my-team', { method: 'POST', body: JSON.stringify(payload) });
      document.getElementById('mtSaveFlash').textContent = '✓ تم إضافة العضو بنجاح!';
    }
    document.getElementById('mtSaveFlash').style.color = 'var(--green)';
    clearTeamMemberForm();
    STATE.editingTeamMemberId = null;
    document.getElementById('addTeamMemberBtn').textContent = 'إضافة عضو';
    renderAddMemberPage();
  } catch (err) {
    document.getElementById('mtSaveFlash').textContent = 'خطأ: ' + err.message;
    document.getElementById('mtSaveFlash').style.color = 'var(--clay)';
  } finally {
    btn.disabled = false;
  }
}

function clearTeamMemberForm() {
  ['mtUsername','mtEmail','mtPassword','mtDeviceName','mtFullName','mtSurname',
   'mtPhone','mtIdNumber','mtIdType','mtAge','mtCity','mtOriginCity',
   'mtTribe','mtEducation','mtNotes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { if (el.type === 'select-one') el.selectedIndex = 0; else el.value = ''; }
  });
}

// ==================== Supervisor Entries Views ====================
async function viewSupervisorEntries(supId) {
  try {
    const entries = await apiJson('/api/supervisors/' + supId + '/entries');
    showEntriesModal('تسجيلات المشرف وفريقه', entries);
  } catch (err) {
    alert(err.message);
  }
}

async function viewMemberEntries(deviceName) {
  try {
    const all = await apiJson('/api/people?createdBy=' + encodeURIComponent(deviceName));
    showEntriesModal('تسجيلات الجهاز: ' + deviceName, all);
  } catch (err) {
    alert(err.message);
  }
}

function showEntriesModal(title, entries) {
  let html = '<div class="modal" style="width:90%; max-width:800px; max-height:80vh; overflow-y:auto;">';
  html += '<h3>' + escapeHtml(title) + '</h3>';
  html += '<p style="margin:8px 0 16px; color:var(--text-dim);">إجمالي: ' + entries.length + ' تسجيلاً</p>';
  if (entries.length > 0) {
    html += '<table><thead><tr><th>الرقم</th><th>الاسم</th><th>المنطقة</th><th>الجهاز</th></tr></thead><tbody>';
    html += entries.slice(0, 100).map(p => {
      const regionLabel = REGION_LABELS[p.region] || p.region || '—';
      return `<tr><td>${escapeHtml(p.registry_id || '')}</td><td>${escapeHtml(p.name)} ${escapeHtml(p.surname || '')}</td><td>${regionLabel}</td><td>${escapeHtml(p.created_by || '')}</td></tr>`;
    }).join('');
    html += '</tbody></table>';
    if (entries.length > 100) {
      html += '<p style="margin-top:12px; color:var(--text-dim);">عرض أول 100 تسجيل من ' + entries.length + '</p>';
    }
  } else {
    html += '<div class="empty-device">لا توجد تسجيلات.</div>';
  }
  html += '<div class="modal-actions" style="margin-top:16px;"><button class="btn btn-ghost" onclick="this.closest(\'.modal-backdrop\').remove()">إغلاق</button></div>';
  html += '</div>';

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop show';
  backdrop.innerHTML = html;
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
  document.body.appendChild(backdrop);
}

// Make viewPersonDetail globally accessible for onclick
function viewPersonDetail(personId) {
  const entries = STORE.currentSupEntries || [];
  const person = entries.find(p => p.id === personId);
  if (!person) return;
  document.getElementById('detailName').textContent = person.name + ' ' + (person.surname || '');
  let grid = '';
  const fields = [
    ['registry_id', 'ID'], ['org_id', 'الرقم التنظيمي'], ['name', 'الاسم'], ['surname', 'اللقب'],
    ['age', 'العمر'], ['city', 'مدينة الإقامة'], ['origin_city', 'مدينة الأصل'], ['region', 'المنطقة'],
    ['tribe', 'القبيلة'], ['id_type', 'نوع الهوية'], ['id_number', 'رقم الهوية'],
    ['education', ' المؤهل العلمي'], ['phone', 'الهاتف'], ['phone2', 'هاتف إضافي'], ['notes', 'ملاحظات'],
    ['created_by', 'الجهاز'], ['created_at', 'تاريخ التسجيل']
  ];
  fields.forEach(([key, label]) => {
    const val = person[key];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      const regionLabel = key === 'region' ? (REGION_LABELS[val] || val) : val;
      grid += `<div class="detail-item"><div class="di-label">${label}</div><div class="di-val">${escapeHtml(String(regionLabel))}</div></div>`;
    }
  });
  document.getElementById('detailGrid').innerHTML = grid;
  document.getElementById('detailModal').classList.add('show');
}

// ==================== Supervisor Entries Views ====================
async function viewSupervisorEntries(supId) {
  try {
    const entries = await apiJson('/api/supervisors/' + supId + '/entries');
    showEntriesModal('تسجيلات المشرف وفريقه', entries);
  } catch (err) {
    alert(err.message);
  }
}

async function viewMemberEntries(deviceName) {
  try {
    const all = await apiJson('/api/people?createdBy=' + encodeURIComponent(deviceName));
    showEntriesModal('تسجيلات الجهاز: ' + deviceName, all);
  } catch (err) {
    alert(err.message);
  }
}

function showEntriesModal(title, entries) {
  let html = '<div class="modal" style="width:90%; max-width:800px; max-height:80vh; overflow-y:auto;">';
  html += '<h3>' + escapeHtml(title) + '</h3>';
  html += '<p style="margin:8px 0 16px; color:var(--text-dim);">إجمالي: ' + entries.length + ' تسجيلاً</p>';
  if (entries.length > 0) {
    html += '<table><thead><tr><th>الرقم</th><th>الاسم</th><th>المنطقة</th><th>الجهاز</th></tr></thead><tbody>';
    html += entries.slice(0, 100).map(p => {
      const regionLabel = REGION_LABELS[p.region] || p.region || '—';
      return `<tr><td>${escapeHtml(p.registry_id || '')}</td><td>${escapeHtml(p.name)} ${escapeHtml(p.surname || '')}</td><td>${regionLabel}</td><td>${escapeHtml(p.created_by || '')}</td></tr>`;
    }).join('');
    html += '</tbody></table>';
    if (entries.length > 100) {
      html += '<p style="margin-top:12px; color:var(--text-dim);">عرض أول 100 تسجيل من ' + entries.length + '</p>';
    }
  } else {
    html += '<div class="empty-device">لا توجد تسجيلات.</div>';
  }
  html += '<div class="modal-actions" style="margin-top:16px;"><button class="btn btn-ghost" onclick="this.closest(\'.modal-backdrop\').remove()">إغلاق</button></div>';
  html += '</div>';

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop show';
  backdrop.innerHTML = html;
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
  document.body.appendChild(backdrop);
}

async function renderUsers() {
  if (!hasPermission('manage_users') && STATE.currentUser.role !== 'super_admin') {
    alert('هذه الصفحة متاحة فقط للمشرف الفائق أو الحسابات المخولة.');
    activatePage('dashboard');
    return;
  }
  document.getElementById('userSearchInput').value = '';
  document.getElementById('userRoleFilter').value = '';
  STATE.editingUserId = null;
  document.getElementById('saveUserBtn').textContent = 'حفظ المستخدم';
  document.getElementById('userUsername').value = '';
  document.getElementById('userEmail').value = '';
  document.getElementById('userDeviceName').value = '';
  document.getElementById('userRole').value = 'member';
  document.getElementById('userPassword').value = '';
  document.getElementById('userPermissions').value = '';
  await renderUserTable();
}

async function renderUserTable() {
  if (!hasPermission('manage_users') && STATE.currentUser.role !== 'super_admin') return;
  let rows = await apiJson('/api/users');
  const query = document.getElementById('userSearchInput').value.trim().toLowerCase();
  const roleFilter = document.getElementById('userRoleFilter').value;
  rows = rows.filter(user => {
    const matchRole = !roleFilter || user.role === roleFilter;
    const matchQuery = !query || user.username.toLowerCase().includes(query) || user.email.toLowerCase().includes(query);
    return matchRole && matchQuery;
  });
  const body = document.getElementById('userTableBody');
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:var(--text-dim);">لا يوجد مستخدمون مطابقون.</td></tr>`;
    return;
  }
  body.innerHTML = rows.map(user => `
    <tr data-user-id="${user.id}">
      <td>${escapeHtml(user.username)}</td>
      <td>${escapeHtml(user.email)}</td>
      <td>${escapeHtml(user.device_name || '-')}</td>
      <td>${getRoleLabel(user.role)}</td>
      <td>${escapeHtml(user.region || '')}</td>
      <td>${escapeHtml(user.permissions || '')}</td>
      <td>${user.active === 0 ? '<span style="color:var(--clay);">غير نشط</span>' : '<span style="color:var(--green);">نشط</span>'}</td>
      <td class="row-actions"><button class="icon-btn edit" data-edit-user="${user.id}" title="تعديل">&#9998; تعديل</button>
        ${user.active === 0 
          ? `<button class="icon-btn" data-activate-user="${user.id}" title="تنشيط" style="color:var(--green);">&#10003; تنشيط</button>`
          : `<button class="icon-btn danger" data-deactivate-user="${user.id}" title="إلغاء تنشيط">&#10005; إلغاء تنشيط</button>`}
      </td>
    </tr>`).join('');
  body.querySelectorAll('[data-edit-user]').forEach(btn => btn.addEventListener('click', async e => {
    e.stopPropagation();
    if (!hasPermission('manage_users') && STATE.currentUser.role !== 'super_admin') {
      alert('غير مخول بتعديل المستخدمين.');
      return;
    }
    const id = Number(btn.dataset.editUser);
    const users = await apiJson('/api/users');
    const user = users.find(u => u.id === id);
    if (!user) return;
    STATE.editingUserId = user.id;
    document.getElementById('userUsername').value = user.username;
    document.getElementById('userEmail').value = user.email;
    document.getElementById('userDeviceName').value = user.device_name || '';
    document.getElementById('userRole').value = user.role;
    document.getElementById('userPermissions').value = user.permissions || '';
    document.getElementById('userPassword').value = '';
    document.getElementById('userRegion').value = user.region || '';
    document.getElementById('userRegionField').style.display = user.role === 'supervisor' ? 'block' : 'none';
    document.getElementById('userFullName').value = user.full_name || '';
    document.getElementById('userSurname').value = user.surname || '';
    document.getElementById('userAge').value = user.age || '';
    document.getElementById('userPhone').value = user.phone || '';
    document.getElementById('userIdNumber').value = user.id_number || '';
    document.getElementById('userIdType').value = user.id_type || '';
    document.getElementById('userCity').value = user.city || '';
    document.getElementById('userOriginCity').value = user.origin_city || '';
    document.getElementById('userTribe').value = user.tribe || '';
    document.getElementById('userEducation').value = user.education || '';
    document.getElementById('userNotes').value = user.notes || '';
    document.getElementById('saveUserBtn').textContent = 'حفظ التعديلات';
  }));
  body.querySelectorAll('[data-deactivate-user]').forEach(btn => btn.addEventListener('click', async e => {
    e.stopPropagation();
    if (!hasPermission('manage_users') && STATE.currentUser.role !== 'super_admin') {
      alert('غير مخول.');
      return;
    }
    const id = Number(btn.dataset.deactivateUser);
    if (id === STATE.currentUser.id) {
      alert('لا يمكنك إلغاء تنشيط حسابك الحالي.');
      return;
    }
    if (!confirm('إلغاء تنشيط هذا المستخدم؟ لن يتمكن من تسجيل الدخول.')) return;
    await apiJson(`/api/users/${id}`, { method: 'DELETE' });
    renderUserTable();
  }));
  body.querySelectorAll('[data-activate-user]').forEach(btn => btn.addEventListener('click', async e => {
    e.stopPropagation();
    const id = Number(btn.dataset.activateUser);
    await apiJson(`/api/users/${id}/activate`, { method: 'PUT' });
    renderUserTable();
  }));
}

async function saveUser() {
  if (!hasPermission('manage_users') && STATE.currentUser.role !== 'super_admin') {
    alert('غير مخول بإدارة المستخدمين.');
    return;
  }
  const username = document.getElementById('userUsername').value.trim();
  const email = document.getElementById('userEmail').value.trim();
  const device_name = document.getElementById('userDeviceName').value.trim();
  const role = document.getElementById('userRole').value;
  const password = document.getElementById('userPassword').value;
  const permissions = document.getElementById('userPermissions').value.trim();
  const region = document.getElementById('userRegion').value;
  const full_name = document.getElementById('userFullName').value.trim();
  const surname = document.getElementById('userSurname').value.trim();
  const age = document.getElementById('userAge').value || null;
  const phone = document.getElementById('userPhone').value.trim();
  const id_number = document.getElementById('userIdNumber').value.trim();
  const id_type = document.getElementById('userIdType').value;
  const city = document.getElementById('userCity').value.trim();
  const origin_city = document.getElementById('userOriginCity').value.trim();
  const tribe = document.getElementById('userTribe').value.trim();
  const education = document.getElementById('userEducation').value.trim();
  const notes = document.getElementById('userNotes').value.trim();
  if (!username || !email || !role) {
    alert('يرجى تعبئة اسم المستخدم والبريد الإلكتروني والدور.');
    return;
  }
  if (role === 'supervisor' && !region) {
    alert('يرجى اختيار المنطقة للمشرف.');
    return;
  }
  try {
    const payload = { username, email, password, role, device_name, permissions, region, full_name, surname, age, phone, id_number, id_type, city, origin_city, tribe, education, notes };
    if (STATE.editingUserId) {
      await apiJson(`/api/users/${STATE.editingUserId}`, { method: 'PUT', body: JSON.stringify(payload) });
      showFlash('userSaveFlash', 'تم حفظ التعديلات.');
    } else {
      if (!password) {
        alert('يرجى تحديد كلمة مرور للحساب الجديد.');
        return;
      }
      await apiJson('/api/users', { method: 'POST', body: JSON.stringify(payload) });
      showFlash('userSaveFlash', 'تم إنشاء المستخدم.');
    }
    STATE.editingUserId = null;
    clearUserFormFields();
    renderUserTable();
  } catch (err) {
    alert(err.message);
  }
}

function clearUserFormFields() {
  document.getElementById('saveUserBtn').textContent = 'حفظ المستخدم';
  ['userUsername','userEmail','userDeviceName','userPassword','userPermissions','userRegion',
   'userFullName','userSurname','userAge','userPhone','userIdNumber','userIdType','userCity',
   'userOriginCity','userTribe','userEducation','userNotes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { if (el.type === 'select-one') el.selectedIndex = 0; else el.value = ''; }
  });
}

async function fillCities(type) {
  const cities = await apiJson('/api/cities');
  const input = document.getElementById(type === 'origin' ? 'f_origin_city' : 'f_city');
  const list = document.getElementById(type === 'origin' ? 'cityList_origin' : 'cityList_res');
  const query = input.value.trim().toLowerCase();
  if (!query) {
    list.classList.remove('show');
    return;
  }
  const matches = cities.filter(c => c.name.toLowerCase().startsWith(query));
  if (!matches.length) {
    list.innerHTML = '<div class="autocomplete-empty">لا توجد مدينة مطابقة — يمكنك كتابة اسم جديد وسيُحفظ تلقائياً</div>';
  } else {
    list.innerHTML = matches.map(c => `<div class="autocomplete-item" data-val="${escapeHtml(c.name)}">${escapeHtml(c.name)} <span style="color:var(--text-dim);font-size:12px;">(${REGION_LABELS[c.region] || c.region || ''})</span></div>`).join('');
  }
  list.classList.add('show');
}

async function fillTribes() {
  const tribes = await apiJson('/api/tribes');
  const input = document.getElementById('f_tribe');
  const list = document.getElementById('tribeList_res');
  if (!input || !list) return;
  const query = input.value.trim().toLowerCase();
  if (!query) { list.classList.remove('show'); return; }
  const matches = tribes.filter(t => String(t.name || '').toLowerCase().startsWith(query));
  if (!matches.length) {
    list.innerHTML = '<div class="autocomplete-empty">لا توجد قبيلة مطابقة — يمكنك كتابة اسم جديد وسيُحفظ تلقائياً</div>';
  } else {
    list.innerHTML = matches.map(t => `<div class="autocomplete-item" data-val="${escapeHtml(t.name)}">${escapeHtml(t.name)}</div>`).join('');
  }
  list.classList.add('show');
}

function initAutocomplete() {
  const setup = (inputId, listId) => {
    const input = document.getElementById(inputId);
    const list = document.getElementById(listId);
    input.addEventListener('input', () => fillCities(inputId === 'f_origin_city' ? 'origin' : 'res'));
    list.addEventListener('click', e => {
      const item = e.target.closest('.autocomplete-item');
      if (item && item.dataset.val) {
        input.value = item.dataset.val;
        list.classList.remove('show');
      }
    });
    document.addEventListener('click', e => {
      if (!input.contains(e.target) && !list.contains(e.target)) list.classList.remove('show');
    });
  };
  setup('f_city', 'cityList_res');
  setup('f_origin_city', 'cityList_origin');

  // Tribe autocomplete (list of tribes is shared like cities).
  const tInput = document.getElementById('f_tribe');
  const tList = document.getElementById('tribeList_res');
  if (tInput && tList) {
    tInput.addEventListener('input', fillTribes);
    tList.addEventListener('click', e => {
      const item = e.target.closest('.autocomplete-item');
      if (item && item.dataset.val) { tInput.value = item.dataset.val; tList.classList.remove('show'); }
    });
    document.addEventListener('click', e => {
      if (!tInput.contains(e.target) && !tList.contains(e.target)) tList.classList.remove('show');
    });
  }
}

async function importExcel(file) {
  if (!file) return;
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    const headerMap = {};
    XLSX_COLUMNS.forEach(([key, label]) => { headerMap[label.toLowerCase()] = key; });
    let added = 0, skipped = 0;
    for (const row of rows) {
      const rec = {};
      Object.keys(row).forEach(h => {
        const key = headerMap[h.trim().toLowerCase()];
        if (key) rec[key] = String(row[h] || '').trim();
      });
      if (!rec.name) continue;
      if (rec.region && REGION_AR_TO_EN[rec.region]) rec.region = REGION_AR_TO_EN[rec.region];
      try {
        await apiJson('/api/people', { method: 'POST', body: JSON.stringify(rec) });
        added++;
      } catch (err) {
        // A 409 is an exact duplicate already in the system -> count it, don't fail.
        if (err.message && err.message.includes('موجود بالفعل')) { skipped++; continue; }
        // Other invalid rows are ignored like before.
      }
    }
    renderAll();
    const skipMsg = skipped > 0 ? `، تم تخطّي ${skipped} مكررًا (موجود مسبقًا)` : '';
    alert(`اكتمل الاستيراد — تمت إضافة ${added} سجلاً${skipMsg}.`);
  } catch (err) {
    alert('تعذّرت قراءة هذا الملف. تأكد أنه ملف إكسل صالح.');
  }
}

function initEvents() {
  document.getElementById('saveBtn').addEventListener('click', createOrUpdatePerson);
  document.getElementById('clearBtn').addEventListener('click', clearPersonForm);
  document.getElementById('cancelEditBtn').addEventListener('click', resetPersonForm);
  document.getElementById('searchInput').addEventListener('input', () => { STATE.pagination.directory.page = 1; renderDirectory(); });
  document.getElementById('searchField').addEventListener('change', () => { STATE.pagination.directory.page = 1; renderDirectory(); });
  document.getElementById('regionFilter').addEventListener('change', () => { STATE.pagination.directory.page = 1; renderDirectory(); });
  document.getElementById('orgIdSearchBtn').addEventListener('click', () => { STATE.pagination.directory.page = 1; renderDirectory(); });
  document.getElementById('orgIdSearch').addEventListener('keydown', e => { if (e.key === 'Enter') { STATE.pagination.directory.page = 1; renderDirectory(); } });
  document.getElementById('resetSearchBtn').addEventListener('click', () => {
    document.getElementById('searchInput').value = '';
    document.getElementById('searchField').value = 'name_surname';
    document.getElementById('regionFilter').value = '';
    document.getElementById('orgIdSearch').value = '';
    STATE.pagination.directory.page = 1;
    renderDirectory();
  });
  document.getElementById('deviceSearchInput').addEventListener('input', () => { STATE.pagination.device.page = 1; renderDevices(); });
  document.getElementById('deviceSearchField').addEventListener('change', () => { STATE.pagination.device.page = 1; renderDevices(); });
  document.getElementById('deviceRegionFilter').addEventListener('change', () => { STATE.pagination.device.page = 1; renderDevices(); });
  document.getElementById('confirmOk').addEventListener('click', deletePerson);
  document.getElementById('confirmCancel').addEventListener('click', () => { STATE.pendingDeleteId = null; document.getElementById('confirmModal').classList.remove('show'); });
  document.getElementById('detailClose').addEventListener('click', () => document.getElementById('detailModal').classList.remove('show'));
  document.getElementById('detailEdit').addEventListener('click', async () => {
    if (!canEdit()) { alert('غير مخول بتعديل السجلات.'); return; }
    const id = STATE.currentDetailId;
    document.getElementById('detailModal').classList.remove('show');
    editPerson(id);
  });
  document.getElementById('detailDelete').addEventListener('click', () => {
    if (!canDelete()) { alert('غير مخول بحذف السجلات.'); return; }
    document.getElementById('detailModal').classList.remove('show');
    confirmDelete(STATE.currentDetailId);
  });
  document.getElementById('addCityBtn').addEventListener('click', addCity);
  document.getElementById('addTribeBtn').addEventListener('click', addTribe);
  document.getElementById('saveUserBtn').addEventListener('click', saveUser);
  document.getElementById('clearUserFormBtn').addEventListener('click', () => {
    STATE.editingUserId = null;
    clearUserFormFields();
  });
  document.getElementById('userRole').addEventListener('change', () => {
    const role = document.getElementById('userRole').value;
    document.getElementById('userRegionField').style.display = role === 'supervisor' ? 'block' : 'none';
  });
  document.getElementById('userSearchInput').addEventListener('input', renderUserTable);
  document.getElementById('userRoleFilter').addEventListener('change', renderUserTable);
  document.getElementById('loginBtn').addEventListener('click', login);
  document.getElementById('logoutBtn').addEventListener('click', logout);
  document.getElementById('loginUsername').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('loginPassword').focus(); });
  document.getElementById('loginPassword').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
  const addEthnicityBtn = document.getElementById('addEthnicityBtn');
  if (addEthnicityBtn) addEthnicityBtn.addEventListener('click', addEthnicity);
  document.getElementById('exportSearchBtn').addEventListener('click', exportSearchExcel);
  document.getElementById('exportBtn').addEventListener('click', exportExcel);
  document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', e => importExcel(e.target.files[0]));

  document.getElementById('addTeamMemberBtn').addEventListener('click', addTeamMember);

  /* Mobile hamburger menu toggle */
  const hamburgerBtn = document.getElementById('hamburgerBtn');
  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebarOverlay');
  function closeSidebar() {
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('show');
    hamburgerBtn.classList.remove('open');
    hamburgerBtn.innerHTML = '&#9776;';
  }
  function toggleSidebar() {
    const isOpen = sidebar.classList.toggle('open');
    sidebarOverlay.classList.toggle('show', isOpen);
    hamburgerBtn.classList.toggle('open', isOpen);
    hamburgerBtn.innerHTML = isOpen ? '&#10005;' : '&#9776;';
  }
  if (hamburgerBtn) {
    hamburgerBtn.addEventListener('click', toggleSidebar);
  }
  if (sidebarOverlay) {
    sidebarOverlay.addEventListener('click', closeSidebar);
  }
  /* Close sidebar on nav click (mobile) */
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      if (window.innerWidth <= 600) closeSidebar();
    });
  });

  initAutocomplete();
}

function renderAll() {
  renderDashboard();
  renderDirectory();
  renderDevices();
  renderCities();
  renderTribes();
  renderEthnicities();
  loadEthnicityDropdowns();
  if (STATE.currentUser && (hasPermission('manage_users') || STATE.currentUser.role === 'super_admin')) {
    renderUserTable();
  }
  if (STATE.currentUser) {
    if (STATE.currentUser.role === 'super_admin') renderSupervisorsPage();
    if (STATE.currentUser.role === 'supervisor') renderMyTeamPage();
  }
}

async function exportExcel() {
  try {
    const rows = await apiJson('/api/people');
    const data = rows.map(p => XLSX_COLUMNS.map(([key]) => key === 'region' ? (REGION_LABELS[p.region] || p.region || '') : p[key] || ''));
    const ws = XLSX.utils.aoa_to_sheet([XLSX_COLUMNS.map(c => c[1]), ...data]);
    ws['!cols'] = XLSX_COLUMNS.map(([key]) => ({ wch: key === 'notes' ? 30 : 16 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'الأشخاص');
    XLSX.writeFile(wb, `السجل-${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (err) {
    alert(err.message);
  }
}

async function exportSearchExcel() {
  try {
    let rows = await apiJson('/api/people');
    const query = document.getElementById('searchInput').value;
    const field = document.getElementById('searchField').value;
    const region = document.getElementById('regionFilter').value;
    rows = filterPeople(rows, query, field, region);
    const orgIdQ = document.getElementById('orgIdSearch').value.trim().toLowerCase();
    if (orgIdQ) {
      rows = rows.filter(p => {
        const num = String(p.org_id || '').slice(-5);
        return num === orgIdQ || p.org_id === orgIdQ;
      });
    }
    const data = rows.map(p => XLSX_COLUMNS.map(([key]) => key === 'region' ? (REGION_LABELS[p.region] || p.region || '') : p[key] || ''));
    const ws = XLSX.utils.aoa_to_sheet([XLSX_COLUMNS.map(c => c[1]), ...data]);
    ws['!cols'] = XLSX_COLUMNS.map(([key]) => ({ wch: key === 'notes' ? 30 : 16 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'الأشخاص');
    const suffix = query || region ? `-بحث-${new Date().toISOString().slice(0, 10)}` : `-${new Date().toISOString().slice(0, 10)}`;
    XLSX.writeFile(wb, `السجل${suffix}.xlsx`);
  } catch (err) {
    alert(err.message);
  }
}

async function bootstrap() {
  try {
    initNavigation();
    initEvents();
    // Always show login modal first
    showLoginModal();
    try {
      const user = await apiJson('/api/me');
      STATE.currentUser = user;
      updateUserSummary();
      setPageVisibility();
      hideLoginModal();
      renderAll();
    } catch (err) {
      STATE.currentUser = null;
      updateUserSummary();
      setPageVisibility();
      // Login modal is already showing
    }
  } catch (err) {
    console.error('Bootstrap error:', err);
    alert('خطأ في تحميل التطبيق: ' + err.message);
  }
}

bootstrap().catch(err => {
  console.error(err);
  alert('حدث خطأ أثناء تحميل التطبيق.');
});

