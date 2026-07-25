'use strict';

    // ---------- Persistent data and shared helpers ----------
    const STORAGE_KEY = 'teacherSkylerTuitionData.v1';
    const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = window.VENUS_SUPABASE_CONFIG;
    const SUBJECT_PRESETS = ['Biology', 'Chemistry', 'Physics', 'Science', 'Mathematics', 'English', 'Bahasa Melayu', 'Other'];
    const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    const FORM_LEVELS = ['Y1','Y2','Y3','Y4','Y5','Y6','F1','F2','F3','F4','F5'];
    const ATTENDANCE_STATUSES = ['Present','Absent','Late','Excused'];
    const ATTENDANCE_REASONS = ['Sick','School Activity','Family Matter','Transport Problem','Personal Reason','No Reason Given','Other'];
    const DEFAULT_SETTINGS = { teacherName: 'LIM CAI CHING', teacherDisplayName: 'Teacher VENUS', receiptFooterName: 'LIM CAI CHING (TEACHER VENUS)', defaultBankName: '' };
    const ADJUSTMENT_OPTIONS = {
      'Additional Charge': ['Printing Fee','Material Fee','Workbook Fee','Extra Lesson','Examination Paper','Other'],
      'Discount': ['Special Discount','Sibling Discount','Promotional Discount','Missed Lesson Adjustment','Other']
    };
    const emptyData = () => ({ version: 3, dataVersion: 0, settings: { ...DEFAULT_SETTINGS }, students: [], classes: [], attendance: [], payments: [], feeAdjustments: [], monthlyRecords: {}, receiptCounters: {}, updatedAt: new Date().toISOString() });
    let state = loadData();
    let paymentSubmitting = false;
    let activeReceiptId = null;
    let studentFormFilter = 'all';
    let sb = null;
    let currentSession = null;
    let currentWorkspaceId = null;
    let currentRole = null;
    let cloudDataVersion = 0;
    let cloudSyncQueue = Promise.resolve();

    function normalizeReceiptNumbers(data) {
      data.payments = Array.isArray(data.payments) ? data.payments : [];
      data.feeAdjustments = Array.isArray(data.feeAdjustments) ? data.feeAdjustments : [];
      data.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
      data.version = 3;
      return false;
    }

    function loadData() {
      try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (parsed && Array.isArray(parsed.students) && Array.isArray(parsed.payments)) {
          const restored = {
            ...emptyData(), ...parsed, version: 3,
            students: parsed.students.map(student => ({ ...student, form: student.form || '' })),
            classes: Array.isArray(parsed.classes) ? parsed.classes : [],
            attendance: Array.isArray(parsed.attendance) ? parsed.attendance : [],
            feeAdjustments: Array.isArray(parsed.feeAdjustments) ? parsed.feeAdjustments : [],
            settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
            monthlyRecords: parsed.monthlyRecords || {}, receiptCounters: parsed.receiptCounters || {}
          };
          normalizeReceiptNumbers(restored);
          return restored;
        }
      } catch (error) { console.warn('Stored data could not be read.', error); }
      return emptyData();
    }

    function saveData(action = null, recordLabel = '') {
      state.updatedAt = new Date().toISOString();
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
      catch (error) { toast('Unable to save. Browser storage may be full.', 'error'); }
      if (sb && currentSession && currentWorkspaceId) queueCloudSync(action, recordLabel);
    }

    function setCloudStatus(label, synced = false) {
      const element = document.getElementById('cloudStatus');
      if (!element) return;
      element.classList.toggle('synced', synced);
      const text = element.querySelector('span:last-child');
      if (text) text.textContent = label;
    }

    function queueCloudSync(action = null, recordLabel = '') {
      const snapshot = JSON.parse(JSON.stringify(state));
      setCloudStatus('Saving to cloud…', false);
      cloudSyncQueue = cloudSyncQueue.then(async () => {
        const { data, error } = await sb.rpc('sync_workspace_state', {
          p_workspace_id: currentWorkspaceId,
          p_state: snapshot,
          p_expected_version: cloudDataVersion,
          p_action: action,
          p_record_label: recordLabel || ''
        });
        if (error) throw error;
        cloudDataVersion = Number(data);
        state.dataVersion = cloudDataVersion;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        setCloudStatus('Cloud synced', true);
        if (action && document.getElementById('page-audit')?.classList.contains('active')) renderAuditLogs();
      }).catch(async error => {
        console.error('Cloud sync failed', error);
        setCloudStatus('Sync needs attention', false);
        if (/changed on another device|40001/i.test(error.message || '')) {
          toast('Cloud data changed on another device. The latest version will be reloaded.', 'error');
          await loadCloudState(false);
        } else toast(`Cloud save failed: ${error.message || 'Unknown error'}`, 'error');
      });
      return cloudSyncQueue;
    }

    function uid(prefix) {
      if (crypto && crypto.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
      return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }

    const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
    const money = (value) => `RM${(Number(value) || 0).toFixed(2)}`;
    const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
    const isoToday = () => {
      const now = new Date();
      const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
      return local.toISOString().slice(0, 10);
    };
    const currentMonthKey = () => isoToday().slice(0, 7);
    const monthKeyFrom = (month, year) => `${year}-${String(month).padStart(2, '0')}`;
    const parseMonthKey = (key) => ({ year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) });
    const monthLabel = (key) => {
      const { year, month } = parseMonthKey(key);
      return `${MONTH_NAMES[month - 1]} ${year}`;
    };
    function shiftMonthKey(key, offset) {
      const { year, month } = parseMonthKey(key);
      const shifted = new Date(Date.UTC(year, month - 1 + offset, 1));
      return monthKeyFrom(shifted.getUTCMonth() + 1, shifted.getUTCFullYear());
    }
    const formatDate = (iso) => {
      if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '—';
      const [year, month, day] = iso.split('-');
      return `${day}/${month}/${year}`;
    };
    const monthIndex = (key) => Number(key.slice(0,4)) * 12 + Number(key.slice(5,7));
    const statusClass = (status) => `badge-${String(status).toLowerCase()}`;
    const getStudent = (id) => state.students.find(student => student.id === id);
    const getClassRecord = (id) => state.classes.find(item => item.id === id);
    const studentMonthlyFee = (student) => roundMoney((student.subjects || []).reduce((sum, subject) => sum + Number(subject.fee || 0), 0));
    const subjectText = (subjects) => (subjects || []).map(subject => `${subject.name} (${money(subject.fee)})`).join(', ') || '—';
    const activeAdjustments = (studentId, key) => state.feeAdjustments.filter(item => !item.voided && item.studentId === studentId && item.monthKey === key);
    function feeBreakdown(studentId, key, baseFee) {
      const adjustments = activeAdjustments(studentId, key);
      const additionalCharges = roundMoney(adjustments.filter(item => item.adjustmentType === 'Additional Charge').reduce((sum,item) => sum + Number(item.amount || 0), 0));
      const discounts = roundMoney(adjustments.filter(item => item.adjustmentType === 'Discount').reduce((sum,item) => sum + Number(item.amount || 0), 0));
      return { baseFee: roundMoney(baseFee), additionalCharges, discounts, finalExpected: roundMoney(Math.max(0, Number(baseFee || 0) + additionalCharges - discounts)), adjustments };
    }
    function feeSummaryMarkup(row) {
      return `<div><span>Base Fee</span><strong>${money(row.baseFee)}</strong></div><div><span>Additional Charges</span><strong class="money-plus">+ ${money(row.additionalCharges)}</strong></div><div><span>Discounts</span><strong class="money-minus">− ${money(row.discounts)}</strong></div><div><span>Final Expected</span><strong>${money(row.expected)}</strong></div><div><span>Amount Paid</span><strong>${money(row.paid)}</strong></div><div><span>Outstanding</span><strong>${money(row.balance)}</strong></div>`;
    }
    const classNamesForStudent = (studentId) => state.classes.filter(item => (item.studentIds || []).includes(studentId)).map(item => item.className).join(', ') || '—';
    const formatTime = (value) => {
      if (!/^\d{2}:\d{2}$/.test(value || '')) return value || '—';
      const [hours, minutes] = value.split(':').map(Number);
      return `${hours % 12 || 12}:${String(minutes).padStart(2,'0')} ${hours >= 12 ? 'PM' : 'AM'}`;
    };
    const dayNameForDate = (iso) => {
      const day = new Date(`${iso}T12:00:00`).getDay();
      return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][day];
    };

    function toast(message, type = 'success') {
      const element = document.createElement('div');
      element.className = `toast ${type}`;
      element.textContent = message;
      document.getElementById('toastStack').appendChild(element);
      setTimeout(() => element.remove(), 3600);
    }

    function openModal(id) {
      const modal = document.getElementById(id);
      modal.classList.add('open');
      document.body.style.overflow = 'hidden';
      if (id === 'receiptModal') {
        const scrollArea = modal.querySelector('.receipt-modal-scroll');
        if (scrollArea) {
          scrollArea.scrollTop = 0;
          scrollArea.scrollLeft = 0;
        }
      }
      setTimeout(() => modal.querySelector('input:not([type="hidden"]), button, select, textarea')?.focus(), 30);
    }

    function closeModal(modal) {
      const element = typeof modal === 'string' ? document.getElementById(modal) : modal;
      element?.classList.remove('open');
      if (!document.querySelector('.modal-backdrop.open')) document.body.style.overflow = '';
    }

    function emptyRow(columns, title, detail = '') {
      return `<tr><td colspan="${columns}"><div class="empty"><div class="empty-icon">◇</div><strong>${esc(title)}</strong>${detail ? `<div>${esc(detail)}</div>` : ''}</div></td></tr>`;
    }

    // Create a fee snapshot the first time an eligible student's month is viewed.
    // This preserves old expected fees even if the student is edited later.
    function ensureMonthlyRecords(key) {
      const selected = monthIndex(key);
      let changed = false;
      state.students.forEach(student => {
        const joinMonth = (student.joinDate || '').slice(0, 7);
        const eligible = student.status === 'Active' && joinMonth && monthIndex(joinMonth) <= selected;
        const recordKey = `${key}|${student.id}`;
        if (eligible && !state.monthlyRecords[recordKey]) {
          state.monthlyRecords[recordKey] = {
            studentId: student.id,
            monthKey: key,
            expectedFee: studentMonthlyFee(student),
            subjects: (student.subjects || []).map(item => ({ name: item.name, fee: Number(item.fee) })),
            createdAt: new Date().toISOString()
          };
          changed = true;
        }
      });
      if (changed) saveData();
    }

    function monthlyRows(key) {
      ensureMonthlyRecords(key);
      return Object.values(state.monthlyRecords)
        .filter(record => record.monthKey === key && getStudent(record.studentId))
        .map(record => {
          const student = getStudent(record.studentId);
          const payments = state.payments.filter(payment => !payment.voided && payment.studentId === student.id && paymentMonthKey(payment) === key);
          const paid = roundMoney(payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
          const breakdown = feeBreakdown(student.id, key, record.expectedFee);
          const expected = breakdown.finalExpected;
          const balance = roundMoney(Math.max(0, expected - paid));
          const status = paid <= 0 ? 'Unpaid' : paid + 0.001 < expected ? 'Partial' : 'Paid';
          const sorted = payments.slice().sort((a,b) => (b.paymentDate || '').localeCompare(a.paymentDate || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
          return { student, record, payments, expected, paid, balance, status, lastPayment: sorted[0] || null, ...breakdown };
        })
        .sort((a,b) => a.student.studentName.localeCompare(b.student.studentName));
    }

    function paymentMonthKey(payment) { return monthKeyFrom(payment.paymentMonth, payment.paymentYear); }
    function getMonthRow(studentId, key) { return monthlyRows(key).find(row => row.student.id === studentId); }

    // ---------- Supabase authentication and shared workspace ----------
    function showAuthMessage(message, isError = false) {
      const element = document.getElementById('authMessage');
      element.textContent = message;
      element.classList.toggle('error', isError);
    }

    function showPasswordSetup(message = 'Set a password to finish activating your account.') {
      document.getElementById('authScreen').hidden = false;
      document.getElementById('appShell').hidden = true;
      document.getElementById('loginForm').hidden = true;
      document.getElementById('setPasswordForm').hidden = false;
      showAuthMessage(message);
    }

    function showLogin(message = 'Public registration is disabled. Only the Owner and invited Co-owner can sign in.', isError = false) {
      document.getElementById('authScreen').hidden = false;
      document.getElementById('appShell').hidden = true;
      document.getElementById('loginForm').hidden = false;
      document.getElementById('setPasswordForm').hidden = true;
      showAuthMessage(message, isError);
    }

    function readAuthLinkContext() {
      const query = new URLSearchParams(location.search);
      const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
      const type = hash.get('type') || query.get('type') || '';
      const error = hash.get('error_description') || query.get('error_description') || hash.get('error') || query.get('error') || '';
      return {
        type,
        error: error ? decodeURIComponent(error.replace(/\+/g, ' ')) : '',
        isPasswordSetup: type === 'invite' || type === 'recovery' || query.has('code')
      };
    }

    async function initializeCloudApp() {
      if (!window.supabase?.createClient) return showLogin('Unable to load the secure cloud connection. Check your internet connection and refresh.', true);
      const authLink = readAuthLinkContext();
      if (authLink.error) return showLogin(`The email link cannot be used: ${authLink.error}. Request a new invitation or password reset email.`, true);
      sb = window.createVenusSupabaseClient();
      sb.auth.onAuthStateChange((event, session) => {
        setTimeout(() => {
          const passwordFlow = event === 'PASSWORD_RECOVERY' || authLink.isPasswordSetup;
          if (passwordFlow && session) { currentSession = session; showPasswordSetup(authLink.type === 'invite' ? 'Set your password to activate the invited account.' : 'Enter a new password for your account.'); }
          else if (event === 'SIGNED_OUT') handleSession(null);
          else if (session) handleSession(session);
        }, 0);
      });
      const { data, error } = await sb.auth.getSession();
      if (error) return showLogin(error.message, true);
      if (data.session && authLink.isPasswordSetup) showPasswordSetup(authLink.type === 'invite' ? 'Set your password to activate the invited account.' : 'Enter a new password for your account.');
      else if (data.session) await handleSession(data.session);
      else if (authLink.isPasswordSetup) showLogin('The invitation link is incomplete or has expired. Request a new invitation or password reset email.', true);
      else showLogin();
    }

    async function handleSession(session) {
      if (!session) {
        currentSession = null; currentWorkspaceId = null; currentRole = null; cloudDataVersion = 0;
        showLogin(); return;
      }
      if (currentSession?.user?.id === session.user.id && !document.getElementById('appShell').hidden) return;
      currentSession = session;
      showAuthMessage('Opening your secure workspace…');
      const { data: membership, error } = await sb.from('workspace_members').select('workspace_id,role,status').eq('user_id', session.user.id).eq('status','active').maybeSingle();
      if (error || !membership) {
        return showLogin('This account is not an active member of the Teacher VENUS Workspace. Ask the Owner to send or restore the invitation.', true);
      }
      currentWorkspaceId = membership.workspace_id;
      currentRole = membership.role;
      document.getElementById('currentUserName').textContent = session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'User';
      document.getElementById('currentUserRole').textContent = currentRole === 'owner' ? 'Owner · Full System Access' : 'Co-owner · Full Management Access';
      document.getElementById('roleAccessNote').textContent = currentRole === 'owner' ? 'Owner – Full System Access' : 'Co-owner – Full Management Access';
      document.querySelectorAll('[data-owner-only]').forEach(element => element.hidden = currentRole !== 'owner');
      document.getElementById('authScreen').hidden = true;
      document.getElementById('appShell').hidden = false;
      await loadCloudState(true);
      renderUsers(); renderAuditLogs();
    }

    async function loadCloudState(offerMigration = false) {
      if (!currentWorkspaceId) return;
      setCloudStatus('Loading cloud data…', false);
      const localSnapshot = JSON.parse(JSON.stringify(state));
      const { data: cloudState, error } = await sb.rpc('get_workspace_state', { p_workspace_id: currentWorkspaceId });
      if (error) { setCloudStatus('Cloud connection failed', false); toast(`Unable to load cloud data: ${error.message}`, 'error'); return; }
      const cloudHasData = (cloudState.students?.length || cloudState.classes?.length || cloudState.payments?.length || cloudState.attendance?.length);
      const localHasData = (localSnapshot.students?.length || localSnapshot.classes?.length || localSnapshot.payments?.length || localSnapshot.attendance?.length);
      cloudDataVersion = Number(cloudState.dataVersion || 0);
      if (offerMigration && currentRole === 'owner' && !cloudHasData && localHasData && confirm('Cloud workspace is empty. Upload the existing records from this browser to Supabase now?')) {
        state = { ...emptyData(), ...localSnapshot, version:3, dataVersion: cloudDataVersion };
        renderAll();
        saveData('Migrated local records to cloud','Workspace');
        await cloudSyncQueue;
      } else {
        state = { ...emptyData(), ...cloudState, version:3, dataVersion: cloudDataVersion };
        const receiptPrefixChanged = normalizeReceiptNumbers(state);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        renderAll();
        if (receiptPrefixChanged) saveData('Updated receipt prefix', 'VE payment receipts');
      }
      setCloudStatus('Cloud synced', true);
    }

    async function submitLogin(event) {
      event.preventDefault();
      const email = document.getElementById('loginEmail').value.trim().toLowerCase();
      const password = document.getElementById('loginPassword').value;
      const button = document.getElementById('loginBtn'); button.disabled = true;
      const { error } = await sb.auth.signInWithPassword({ email, password });
      button.disabled = false;
      if (error) showAuthMessage(error.message, true);
    }

    async function requestPasswordReset() {
      const email = document.getElementById('loginEmail').value.trim().toLowerCase();
      if (!email) return showAuthMessage('Enter your invited email address first.', true);
      if (!sb) return showAuthMessage('Cloud connection is not ready. Refresh the page and try again.', true);
      try {
        showAuthMessage('Sending password reset email…');
        const redirectTo = location.href.split('#')[0].split('?')[0];
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
        showAuthMessage(error ? error.message : 'Password reset email sent. Check the inbox and spam folder.', Boolean(error));
      } catch (error) {
        showAuthMessage(`Unable to send reset email: ${error.message || 'Unknown error'}`, true);
      }
    }

    async function submitNewPassword(event) {
      event.preventDefault();
      const password = document.getElementById('newPassword').value;
      const confirmPassword = document.getElementById('confirmPassword').value;
      if (password.length < 8 || password !== confirmPassword) return showAuthMessage('Passwords must match and contain at least 8 characters.', true);
      const { data, error } = await sb.auth.updateUser({ password });
      if (error) return showAuthMessage(error.message, true);
      history.replaceState(null, '', location.pathname);
      document.getElementById('setPasswordForm').reset();
      await handleSession((await sb.auth.getSession()).data.session);
    }

    async function signOut() {
      await cloudSyncQueue;
      await sb.auth.signOut();
      localStorage.removeItem(STORAGE_KEY);
      state = emptyData(); currentSession = null; currentWorkspaceId = null; currentRole = null;
      showLogin('Signed out successfully.');
    }

    async function renderUsers() {
      if (!sb || !currentWorkspaceId) return;
      const { data, error } = await sb.rpc('get_workspace_directory', { p_workspace_id: currentWorkspaceId });
      if (error) return document.getElementById('usersBody').innerHTML = emptyRow(6,'Unable to load users',error.message);
      document.getElementById('usersBody').innerHTML = data.length ? data.map(member => {
        const roleLabel = member.role === 'owner' ? 'Owner' : 'Co-owner';
        const accessLabel = member.role === 'owner' ? 'Full System Access' : 'Full Management Access';
        const action = currentRole === 'owner' && member.role === 'co_owner' && member.userId ? `<button class="btn ${member.status === 'active' ? 'btn-danger' : 'btn-secondary'} btn-sm" data-member-user="${member.userId}" data-member-status="${member.status === 'active' ? 'inactive' : 'active'}">${member.status === 'active' ? 'Remove' : 'Restore'}</button>` : '—';
        return `<tr><td><strong>${esc(member.name || roleLabel)}</strong></td><td>${esc(member.email)}</td><td><span class="badge ${member.role === 'owner' ? 'badge-active' : 'badge-excused'}">${roleLabel}</span></td><td>${accessLabel}</td><td>${esc(member.status === 'invited' ? 'Invitation sent' : member.status)}</td><td>${action}</td></tr>`;
      }).join('') : emptyRow(6,'No workspace members');
    }

    async function inviteCoOwner(event) {
      event.preventDefault();
      if (currentRole !== 'owner') return toast('Only the Owner can invite the Co-owner.', 'error');
      const button = document.getElementById('inviteBtn'); button.disabled = true;
      const email = document.getElementById('inviteEmail').value.trim().toLowerCase();
      const { data, error } = await sb.functions.invoke('invite-user', { body: { workspaceId: currentWorkspaceId, email, fullName: document.getElementById('inviteName').value.trim() || 'Co-owner' } });
      button.disabled = false;
      if (error || data?.error) return toast(data?.error || error.message, 'error');
      toast('Co-owner invitation sent successfully.'); renderUsers(); renderAuditLogs();
    }

    async function setCoOwnerStatus(userId, status) {
      if (currentRole !== 'owner') return toast('Only the Owner can manage users.', 'error');
      if (!confirm(`${status === 'active' ? 'Restore' : 'Remove'} this Co-owner account?`)) return;
      const { error } = await sb.rpc('set_co_owner_status', { p_workspace_id: currentWorkspaceId, p_user_id: userId, p_status: status });
      if (error) return toast(error.message, 'error');
      toast(status === 'active' ? 'Co-owner restored.' : 'Co-owner removed.'); renderUsers(); renderAuditLogs();
    }

    async function renderAuditLogs() {
      if (!sb || !currentWorkspaceId) return;
      const { data, error } = await sb.from('audit_logs').select('user_email,user_role,action,record_label,created_at').eq('workspace_id',currentWorkspaceId).order('created_at',{ascending:false}).limit(300);
      if (error) return document.getElementById('auditBody').innerHTML = emptyRow(6,'Unable to load Audit Logs',error.message);
      document.getElementById('auditBody').innerHTML = data.length ? data.map(log => {
        const instant = new Date(log.created_at);
        const date = instant.toLocaleDateString('en-GB',{timeZone:'Asia/Kuala_Lumpur'});
        const time = instant.toLocaleTimeString('en-MY',{timeZone:'Asia/Kuala_Lumpur',hour:'2-digit',minute:'2-digit',second:'2-digit'});
        return `<tr><td>${esc(log.user_email)}</td><td>${log.user_role === 'owner' ? 'Owner' : 'Co-owner'}</td><td><strong>${esc(log.action)}</strong></td><td>${esc(log.record_label || '—')}</td><td>${esc(date)}</td><td>${esc(time)}</td></tr>`;
      }).join('') : emptyRow(6,'No audit activity yet');
    }

    function renderAll() {
      state.settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
      renderDashboard();
      renderStudents();
      renderClasses();
      renderTimetable();
      renderAttendanceControls();
      renderAttendanceHistoryFilters();
      renderAttendanceHistory();
      renderMonthly();
      renderHistoryFilters();
      renderHistory();
      renderSettings();
      document.getElementById('sampleBanner').hidden = state.students.length > 0 || state.payments.length > 0;
    }

    function renderSettings() {
      document.getElementById('settingTeacherName').value = state.settings.teacherName;
      document.getElementById('settingDisplayName').value = state.settings.teacherDisplayName;
      document.getElementById('settingReceiptFooter').value = state.settings.receiptFooterName;
      document.getElementById('settingBankName').value = state.settings.defaultBankName;
    }

    function saveSettings(event) {
      event.preventDefault();
      const next = {
        teacherName: document.getElementById('settingTeacherName').value.trim(),
        teacherDisplayName: document.getElementById('settingDisplayName').value.trim(),
        receiptFooterName: document.getElementById('settingReceiptFooter').value.trim(),
        defaultBankName: document.getElementById('settingBankName').value.trim()
      };
      if (!next.teacherName || !next.teacherDisplayName || !next.receiptFooterName) return toast('Please complete all required settings.', 'error');
      state.settings = next;
      saveData('Changed settings','Receipt settings');
      toast('Settings saved successfully.');
    }

    // ---------- Dashboard and monthly fee tables ----------
    function summaryStudentCount(key) {
      const selectedMonth = monthIndex(key);
      const studentIds = new Set(
        Object.values(state.monthlyRecords)
          .filter(record => record.monthKey === key && getStudent(record.studentId))
          .map(record => record.studentId)
      );
      state.students.forEach(student => {
        const joinMonth = (student.joinDate || '').slice(0, 7);
        if (student.status === 'Active' && joinMonth && monthIndex(joinMonth) <= selectedMonth) studentIds.add(student.id);
      });
      return studentIds.size;
    }

    function monthlySummaryPoint(key) {
      const { year, month } = parseMonthKey(key);
      const collected = roundMoney(
        state.payments
          .filter(payment => !payment.voided && paymentMonthKey(payment) === key)
          .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
      );
      return {
        key,
        label: monthLabel(key),
        shortLabel: `${MONTH_NAMES[month - 1].slice(0, 3)} ${String(year).slice(-2)}`,
        collected,
        students: summaryStudentCount(key)
      };
    }

    function monthlySummarySeries(endKey, count = 12) {
      return Array.from({ length: count }, (_, index) => shiftMonthKey(endKey, index - count + 1))
        .map(key => {
          const current = monthlySummaryPoint(key);
          const previous = monthlySummaryPoint(shiftMonthKey(key, -1));
          return {
            ...current,
            previousCollected: previous.collected,
            previousStudents: previous.students,
            incomeChange: roundMoney(current.collected - previous.collected),
            studentChange: current.students - previous.students
          };
        });
    }

    const changeTone = value => value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral';
    const signedCount = value => value > 0 ? `+${value}` : String(value);
    const signedMoney = value => `${value > 0 ? '+' : value < 0 ? '−' : ''}${money(Math.abs(value))}`;
    const trendLabel = (incomeChange, studentChange) => {
      if (incomeChange > 0 || (incomeChange === 0 && studentChange > 0)) return 'Increased';
      if (incomeChange < 0 || (incomeChange === 0 && studentChange < 0)) return 'Decreased';
      return 'No change';
    };

    function drawMonthlySummaryChart(series) {
      const canvas = document.getElementById('monthlySummaryChart');
      const container = canvas?.parentElement;
      if (!canvas || !container) return;
      const width = Math.max(300, Math.floor(container.clientWidth || 900));
      const height = width < 600 ? 270 : 330;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.style.height = `${height}px`;
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);

      const padding = { top: 18, right: 46, bottom: 48, left: width < 600 ? 48 : 64 };
      const chartWidth = width - padding.left - padding.right;
      const chartHeight = height - padding.top - padding.bottom;
      const incomeMaxRaw = Math.max(1, ...series.flatMap(item => [item.collected, item.previousCollected]));
      const incomeStep = Math.max(10, Math.ceil(incomeMaxRaw / 4 / 10) * 10);
      const incomeMax = incomeStep * 4;
      const studentMax = Math.max(1, ...series.map(item => item.students));

      context.font = '11px Inter, system-ui, sans-serif';
      context.lineWidth = 1;
      context.textBaseline = 'middle';
      for (let tick = 0; tick <= 4; tick += 1) {
        const y = padding.top + chartHeight - chartHeight * (tick / 4);
        context.strokeStyle = '#f0ccdc';
        context.beginPath();
        context.moveTo(padding.left, y);
        context.lineTo(width - padding.right, y);
        context.stroke();
        context.fillStyle = '#755d6b';
        context.textAlign = 'right';
        context.fillText(`RM${Math.round(incomeStep * tick)}`, padding.left - 8, y);
        context.textAlign = 'left';
        context.fillText(String(Math.round(studentMax * tick / 4)), width - padding.right + 8, y);
      }

      const groupWidth = chartWidth / series.length;
      const barWidth = Math.max(4, Math.min(14, groupWidth * 0.28));
      series.forEach((item, index) => {
        const centerX = padding.left + groupWidth * index + groupWidth / 2;
        const currentHeight = chartHeight * (item.collected / incomeMax);
        const previousHeight = chartHeight * (item.previousCollected / incomeMax);
        context.fillStyle = '#f0b7d0';
        context.fillRect(centerX - barWidth - 1, padding.top + chartHeight - previousHeight, barWidth, previousHeight);
        context.fillStyle = '#d96c9d';
        context.fillRect(centerX + 1, padding.top + chartHeight - currentHeight, barWidth, currentHeight);
        if (width >= 600 || index % 3 === 0 || index === series.length - 1) {
          context.fillStyle = '#755d6b';
          context.textAlign = 'center';
          context.textBaseline = 'top';
          context.fillText(item.shortLabel, centerX, padding.top + chartHeight + 12);
        }
      });

      context.strokeStyle = '#c76b08';
      context.fillStyle = '#c76b08';
      context.lineWidth = 2.5;
      context.lineJoin = 'round';
      context.beginPath();
      series.forEach((item, index) => {
        const x = padding.left + groupWidth * index + groupWidth / 2;
        const y = padding.top + chartHeight - chartHeight * (item.students / studentMax);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
      series.forEach((item, index) => {
        const x = padding.left + groupWidth * index + groupWidth / 2;
        const y = padding.top + chartHeight - chartHeight * (item.students / studentMax);
        context.beginPath();
        context.arc(x, y, 3.2, 0, Math.PI * 2);
        context.fill();
      });
    }

    function renderMonthlySummary(key) {
      const series = monthlySummarySeries(key);
      const latest = series[series.length - 1];
      const first = series[0];
      document.getElementById('monthlySummaryPeriod').textContent = `${first.label} – ${latest.label}`;
      document.getElementById('monthlySummaryHighlights').innerHTML = `
        <div><span>${esc(latest.label)} Tuition Received</span><strong>${money(latest.collected)}</strong><small>Current cloud payment records</small></div>
        <div><span>Income vs Previous Month</span><strong class="${changeTone(latest.incomeChange)}">${signedMoney(latest.incomeChange)}</strong><small>Previous: ${money(latest.previousCollected)}</small></div>
        <div><span>${esc(latest.label)} Students</span><strong>${latest.students}</strong><small class="${changeTone(latest.studentChange)}">${signedCount(latest.studentChange)} compared with previous month</small></div>`;
      document.getElementById('monthlySummaryBody').innerHTML = series.slice().reverse().map(item => {
        const trend = trendLabel(item.incomeChange, item.studentChange);
        return `<tr>
          <td><strong>${esc(item.label)}</strong></td>
          <td>${item.students}</td>
          <td><span class="summary-change ${changeTone(item.studentChange)}">${signedCount(item.studentChange)}</span></td>
          <td class="money">${money(item.collected)}</td>
          <td><span class="summary-change ${changeTone(item.incomeChange)}">${signedMoney(item.incomeChange)}</span></td>
          <td><span class="trend-pill ${changeTone(item.incomeChange || item.studentChange)}">${trend}</span></td>
        </tr>`;
      }).join('');
      const hasData = series.some(item => item.collected > 0 || item.students > 0);
      document.getElementById('monthlySummaryChartEmpty').hidden = hasData;
      document.getElementById('monthlySummaryChart').hidden = false;
      document.getElementById('monthlySummaryChart').setAttribute('aria-label', `Monthly tuition and student trend from ${first.label} to ${latest.label}`);
      drawMonthlySummaryChart(series);
    }

    function renderDashboard() {
      const key = document.getElementById('dashboardMonth').value || currentMonthKey();
      document.getElementById('studentCountTotal').textContent = state.students.length;
      FORM_LEVELS.forEach(form => document.getElementById(`studentCount${form}`).textContent = state.students.filter(student => student.form === form).length);
      const rows = monthlyRows(key);
      const totals = rows.reduce((result, row) => {
        result.expected += row.expected;
        result.collected += row.paid;
        result.outstanding += row.balance;
        result[row.status.toLowerCase()] += 1;
        return result;
      }, { expected: 0, collected: 0, outstanding: 0, paid: 0, partial: 0, unpaid: 0 });
      document.getElementById('statExpected').textContent = money(totals.expected);
      document.getElementById('statCollected').textContent = money(totals.collected);
      document.getElementById('statOutstanding').textContent = money(totals.outstanding);
      document.getElementById('statPaid').textContent = totals.paid;
      document.getElementById('statPartial').textContent = totals.partial;
      document.getElementById('statUnpaid').textContent = totals.unpaid;
      const outstanding = rows.filter(row => row.status !== 'Paid');
      document.getElementById('dashboardOutstandingBody').innerHTML = outstanding.length ? outstanding.map(row => `
        <tr><td><button class="name-link" data-student-history="${row.student.id}">${esc(row.student.studentName)}</button></td>
        <td class="subjects">${esc(subjectText(row.record.subjects))}</td><td class="money">${money(row.expected)}</td><td class="money">${money(row.paid)}</td><td class="money">${money(row.balance)}</td>
        <td><span class="badge ${statusClass(row.status)}">${row.status}</span></td><td><div class="actions"><button class="btn btn-primary btn-sm" data-payment="${row.student.id}" data-month="${key}">Record Payment</button><button class="btn btn-secondary btn-sm" data-reminder="${row.student.id}" data-month="${key}">WhatsApp</button></div></td></tr>`).join('') : emptyRow(7, 'No outstanding payments', rows.length ? 'Everyone has paid for this month.' : 'No eligible students for this month.');
      renderMonthlySummary(key);
      renderAttendanceDashboard(key);
    }

    function renderMonthly() {
      const key = document.getElementById('monthlyMonth').value || currentMonthKey();
      const rows = monthlyRows(key);
      document.getElementById('monthlyBody').innerHTML = rows.length ? rows.map(row => `
        <tr><td><button class="name-link" data-student-history="${row.student.id}">${esc(row.student.studentName)}</button></td><td class="subjects">${esc(subjectText(row.record.subjects))}</td>
        <td class="money">${money(row.baseFee)}</td><td class="money money-plus">+ ${money(row.additionalCharges)}</td><td class="money money-minus">− ${money(row.discounts)}</td><td class="money">${money(row.expected)}</td><td class="money">${money(row.paid)}</td><td class="money">${money(row.balance)}</td><td><span class="badge ${statusClass(row.status)}">${row.status}</span></td>
        <td><div class="actions"><button class="btn btn-secondary btn-sm" data-adjustment="${row.student.id}" data-month="${key}">Fee Adjustment</button><button class="btn btn-primary btn-sm" data-payment="${row.student.id}" data-month="${key}">Record Payment</button>${row.status !== 'Paid' ? `<button class="btn btn-secondary btn-sm" data-reminder="${row.student.id}" data-month="${key}">WhatsApp</button>` : ''}</div></td></tr>`).join('') : emptyRow(10, 'No students for this month', 'Only active students who have joined by this month are shown.');
    }

    // ---------- Student management ----------
    function renderStudents() {
      const query = document.getElementById('studentSearch').value.trim().toLowerCase();
      const status = document.getElementById('studentStatusFilter').value;
      const students = state.students.filter(student => {
        const haystack = `${student.studentName} ${student.parentName} ${student.parentPhone} ${student.form} ${subjectText(student.subjects)} ${classNamesForStudent(student.id)}`.toLowerCase();
        return (!query || haystack.includes(query)) && (status === 'all' || student.status === status) && (studentFormFilter === 'all' || student.form === studentFormFilter);
      }).sort((a,b) => a.studentName.localeCompare(b.studentName));
      document.getElementById('studentsBody').innerHTML = students.length ? students.map(student => `
        <tr><td><button class="name-link" data-student-history="${student.id}">${esc(student.studentName)}</button><div class="help">${esc(student.parentName || '')}</div></td><td><strong>${esc(student.form || 'Not set')}</strong></td><td class="subjects">${esc(subjectText(student.subjects))}</td><td class="subjects">${esc(classNamesForStudent(student.id))}</td><td>${esc(student.parentPhone)}</td><td class="money">${money(studentMonthlyFee(student))}</td>
        <td><span class="badge ${statusClass(student.status)}">${esc(student.status)}</span></td><td><div class="actions"><button class="btn btn-secondary btn-sm" data-edit-student="${student.id}">Edit</button>${student.status === 'Active' ? `<button class="btn btn-secondary btn-sm" data-deactivate-student="${student.id}">Deactivate</button>` : ''}<button class="btn btn-danger btn-sm" data-delete-student="${student.id}">Delete</button></div></td></tr>`).join('') : emptyRow(8, 'No students found', query || status !== 'all' || studentFormFilter !== 'all' ? 'Try changing your search or filter.' : 'Add your first student to begin.');
    }

    function addSubjectRow(subject = { name: '', fee: '' }) {
      const row = document.createElement('div');
      row.className = 'subject-row';
      row.innerHTML = `<div><label>Subject</label><input class="subject-name" list="subjectOptions" maxlength="80" value="${esc(subject.name)}" placeholder="Choose or type a subject"></div><div><label>Fee (RM)</label><input class="subject-fee" type="number" min="0.01" step="0.01" value="${subject.fee !== '' ? esc(subject.fee) : ''}" placeholder="0.00"></div><button type="button" class="icon-btn remove-subject" aria-label="Remove subject">✕</button>`;
      row.querySelectorAll('input').forEach(input => input.addEventListener('input', updateStudentFeeTotal));
      row.querySelector('.remove-subject').addEventListener('click', () => { row.remove(); updateStudentFeeTotal(); });
      document.getElementById('subjectRows').appendChild(row);
      updateStudentFeeTotal();
    }

    function updateStudentFeeTotal() {
      const total = [...document.querySelectorAll('.subject-fee')].reduce((sum, input) => sum + Number(input.value || 0), 0);
      document.getElementById('studentFeeTotal').textContent = money(total);
    }

    function openStudentForm(studentId = null) {
      const student = studentId ? getStudent(studentId) : null;
      document.getElementById('studentForm').reset();
      document.getElementById('studentId').value = student?.id || '';
      document.getElementById('studentModalTitle').textContent = student ? 'Edit Student' : 'Add Student';
      document.getElementById('studentName').value = student?.studentName || '';
      document.getElementById('parentName').value = student?.parentName || '';
      document.getElementById('parentPhone').value = student?.parentPhone || '';
      document.getElementById('joinDate').value = student?.joinDate || isoToday();
      document.getElementById('studentFormLevel').value = student?.form || '';
      document.getElementById('studentStatus').value = student?.status || 'Active';
      document.getElementById('studentNotes').value = student?.notes || '';
      document.getElementById('subjectRows').innerHTML = '';
      (student?.subjects?.length ? student.subjects : [{ name: '', fee: '' }]).forEach(addSubjectRow);
      openModal('studentModal');
    }

    // Keep the current/future schedule aligned with student edits while leaving
    // earlier month snapshots and all paid months untouched.
    function syncCurrentAndFutureRecords(student) {
      const current = monthIndex(currentMonthKey());
      Object.keys(state.monthlyRecords).forEach(recordKey => {
        const record = state.monthlyRecords[recordKey];
        if (record.studentId !== student.id || monthIndex(record.monthKey) < current) return;
        const hasPayments = state.payments.some(payment => payment.studentId === student.id && paymentMonthKey(payment) === record.monthKey);
        const joinedByMonth = monthIndex((student.joinDate || '').slice(0, 7)) <= monthIndex(record.monthKey);
        if ((!joinedByMonth || student.status !== 'Active') && !hasPayments) {
          delete state.monthlyRecords[recordKey];
        } else {
          record.expectedFee = studentMonthlyFee(student);
          record.subjects = student.subjects.map(item => ({ name: item.name, fee: Number(item.fee) }));
          record.updatedAt = new Date().toISOString();
        }
      });
    }

    function syncClassMembershipForStudent(student) {
      state.classes.forEach(classRecord => {
        if (student.status !== 'Active' || classRecord.form !== student.form) classRecord.studentIds = (classRecord.studentIds || []).filter(studentId => studentId !== student.id);
      });
    }

    function saveStudent(event) {
      event.preventDefault();
      const id = document.getElementById('studentId').value;
      const studentName = document.getElementById('studentName').value.trim();
      const parentPhone = document.getElementById('parentPhone').value.trim();
      const joinDate = document.getElementById('joinDate').value;
      const form = document.getElementById('studentFormLevel').value;
      const subjects = [...document.querySelectorAll('.subject-row')].map(row => ({
        name: row.querySelector('.subject-name').value.trim(),
        fee: roundMoney(row.querySelector('.subject-fee').value)
      })).filter(subject => subject.name || subject.fee);
      if (!studentName || !parentPhone || !joinDate || !form) return toast('Please complete all required fields, including Form.', 'error');
      if (!subjects.length || subjects.some(subject => !subject.name || subject.fee <= 0)) return toast('Add at least one subject with a fee greater than RM0.00.', 'error');
      const payload = {
        studentName, parentName: document.getElementById('parentName').value.trim(), parentPhone, joinDate, form,
        status: document.getElementById('studentStatus').value, subjects,
        monthlyFee: roundMoney(subjects.reduce((sum, subject) => sum + subject.fee, 0)),
        notes: document.getElementById('studentNotes').value.trim()
      };
      if (id) {
        const index = state.students.findIndex(student => student.id === id);
        if (index < 0) return toast('Student record was not found.', 'error');
        state.students[index] = { ...state.students[index], ...payload, updatedAt: new Date().toISOString() };
        syncCurrentAndFutureRecords(state.students[index]);
        syncClassMembershipForStudent(state.students[index]);
        toast('Student updated successfully.');
      } else {
        state.students.push({ id: uid('stu'), ...payload, createdAt: new Date().toISOString() });
        toast('Student added successfully.');
      }
      saveData(id ? 'Updated student' : 'Added student', studentName); closeModal('studentModal'); renderAll();
    }

    function deactivateStudent(id) {
      const student = getStudent(id);
      if (!student || !confirm(`Deactivate ${student.studentName}?`)) return;
      student.status = 'Inactive'; student.updatedAt = new Date().toISOString();
      syncCurrentAndFutureRecords(student);
      syncClassMembershipForStudent(student);
      saveData('Archived student', student.studentName); renderAll(); toast('Student deactivated successfully.');
    }

    function deleteStudent(id) {
      const student = getStudent(id);
      if (!student || !confirm('Are you sure you want to delete this student?')) return;
      state.students = state.students.filter(item => item.id !== id);
      state.payments = state.payments.filter(payment => payment.studentId !== id);
      state.feeAdjustments = state.feeAdjustments.filter(item => item.studentId !== id);
      state.attendance = state.attendance.filter(record => record.studentId !== id);
      state.classes.forEach(classRecord => classRecord.studentIds = (classRecord.studentIds || []).filter(studentId => studentId !== id));
      Object.keys(state.monthlyRecords).forEach(key => { if (state.monthlyRecords[key].studentId === id) delete state.monthlyRecords[key]; });
      saveData('Deleted student', student.studentName); renderAll(); toast('Student and linked records deleted successfully.');
    }

    // ---------- Classes, timetable and attendance ----------
    function scheduledClassCount(key) {
      const { year, month } = parseMonthKey(key);
      const daysInMonth = new Date(year, month, 0).getDate();
      return state.classes.filter(item => item.status === 'Active').reduce((total, classRecord) => {
        let count = 0;
        for (let day = 1; day <= daysInMonth; day += 1) {
          const iso = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
          if (dayNameForDate(iso) === classRecord.day) count += 1;
        }
        return total + count;
      }, 0);
    }

    function renderAttendanceDashboard(key) {
      const today = isoToday();
      const todayClasses = state.classes.filter(item => item.status === 'Active' && item.day === dayNameForDate(today));
      const pending = todayClasses.filter(item => {
        const roster = (item.studentIds || []).filter(studentId => getStudent(studentId));
        const recorded = new Set(state.attendance.filter(record => record.classId === item.id && record.attendanceDate === today).map(record => record.studentId));
        return roster.length > 0 && roster.some(studentId => !recorded.has(studentId));
      });
      const monthRecords = state.attendance.filter(record => (record.attendanceDate || '').slice(0,7) === key);
      const counts = Object.fromEntries(ATTENDANCE_STATUSES.map(status => [status, monthRecords.filter(record => record.status === status).length]));
      const rate = monthRecords.length ? counts.Present / monthRecords.length * 100 : 0;
      document.getElementById('attendanceDashboardMonth').textContent = monthLabel(key);
      document.getElementById('statTodayClasses').textContent = todayClasses.length;
      document.getElementById('statPendingAttendance').textContent = pending.length;
      document.getElementById('statMonthClasses').textContent = scheduledClassCount(key);
      document.getElementById('statAttendancePresent').textContent = counts.Present;
      document.getElementById('statAttendanceAbsent').textContent = counts.Absent;
      document.getElementById('statAttendanceLate').textContent = counts.Late;
      document.getElementById('statAttendanceExcused').textContent = counts.Excused;
      document.getElementById('statAttendanceRate').textContent = `${rate.toFixed(1)}%`;
      const recent = state.attendance.filter(record => record.status !== 'Present').sort((a,b) => (b.attendanceDate || '').localeCompare(a.attendanceDate || '') || (b.recordedAt || '').localeCompare(a.recordedAt || '')).slice(0,8);
      document.getElementById('recentAbsenteesBody').innerHTML = recent.length ? recent.map(record => {
        const student = getStudent(record.studentId); const classRecord = getClassRecord(record.classId);
        return `<tr><td><button class="name-link" data-student-history="${record.studentId}">${esc(student?.studentName || 'Unknown student')}</button></td><td>${esc(classRecord?.className || 'Deleted class')}</td><td>${formatDate(record.attendanceDate)}</td><td><span class="badge ${statusClass(record.status)}">${esc(record.status)}</span></td><td>${esc(record.reason || '—')}</td></tr>`;
      }).join('') : emptyRow(5, 'No recent absentees', 'Absent, late and excused records will appear here.');
    }

    function renderClasses() {
      const query = document.getElementById('classSearch').value.trim().toLowerCase();
      const status = document.getElementById('classStatusFilter').value;
      const classes = state.classes.filter(item => {
        const haystack = `${item.className} ${item.form} ${item.subject} ${item.day}`.toLowerCase();
        return (!query || haystack.includes(query)) && (status === 'all' || item.status === status);
      }).sort((a,b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.startTime.localeCompare(b.startTime));
      document.getElementById('classesBody').innerHTML = classes.length ? classes.map(item => `
        <tr><td><strong>${esc(item.className)}</strong><div class="help">${esc(item.notes || '')}</div></td><td>${esc(item.form)}</td><td>${esc(item.subject)}</td><td>${esc(item.day)}<div class="help">${formatTime(item.startTime)} – ${formatTime(item.endTime)}</div></td><td class="money">${money(item.monthlyFee)}</td><td>${(item.studentIds || []).filter(getStudent).length}</td><td><span class="badge ${statusClass(item.status)}">${esc(item.status)}</span></td><td><div class="actions"><button class="btn btn-secondary btn-sm" data-edit-class="${item.id}">Edit</button><button class="btn btn-danger btn-sm" data-delete-class="${item.id}">Delete</button></div></td></tr>`).join('') : emptyRow(8, 'No classes found', query || status !== 'all' ? 'Try changing your search or filter.' : 'Add your first class to build the timetable.');
    }

    function renderClassStudentOptions(form, selectedIds = []) {
      const list = document.getElementById('classStudentList');
      if (!form) { list.innerHTML = '<div class="empty" style="padding:20px">Select a Form first.</div>'; return; }
      const students = state.students.filter(student => student.form === form && student.status === 'Active').sort((a,b) => a.studentName.localeCompare(b.studentName));
      list.innerHTML = students.length ? students.map(student => `<div class="student-check"><input type="checkbox" class="class-student-check" id="classStudent_${student.id}" value="${student.id}" ${selectedIds.includes(student.id) ? 'checked' : ''}><label for="classStudent_${student.id}">${esc(student.studentName)} <span class="help">${esc(subjectText(student.subjects))}</span></label></div>`).join('') : '<div class="empty" style="padding:20px">No active students in this Form.</div>';
    }

    function openClassForm(classId = null) {
      const item = classId ? getClassRecord(classId) : null;
      document.getElementById('classForm').reset();
      document.getElementById('classId').value = item?.id || '';
      document.getElementById('classModalTitle').textContent = item ? 'Edit Class' : 'Add Class';
      document.getElementById('className').value = item?.className || '';
      document.getElementById('classFormLevel').value = item?.form || '';
      document.getElementById('classSubject').value = item?.subject || '';
      document.getElementById('classDay').value = item?.day || 'Monday';
      document.getElementById('classStartTime').value = item?.startTime || '';
      document.getElementById('classEndTime').value = item?.endTime || '';
      document.getElementById('classMonthlyFee').value = item?.monthlyFee || '';
      document.getElementById('classStatus').value = item?.status || 'Active';
      document.getElementById('classNotes').value = item?.notes || '';
      renderClassStudentOptions(item?.form || '', item?.studentIds || []);
      openModal('classModal');
    }

    function saveClass(event) {
      event.preventDefault();
      const id = document.getElementById('classId').value;
      const className = document.getElementById('className').value.trim();
      const form = document.getElementById('classFormLevel').value;
      const subject = document.getElementById('classSubject').value.trim();
      const day = document.getElementById('classDay').value;
      const startTime = document.getElementById('classStartTime').value;
      const endTime = document.getElementById('classEndTime').value;
      const monthlyFee = roundMoney(document.getElementById('classMonthlyFee').value);
      if (!className || !form || !subject || !day || !startTime || !endTime || monthlyFee <= 0) return toast('Please complete all required class fields.', 'error');
      if (endTime <= startTime) return toast('End time must be later than start time.', 'error');
      const payload = { className, form, subject, day, startTime, endTime, monthlyFee, studentIds: [...document.querySelectorAll('.class-student-check:checked')].map(input => input.value), status: document.getElementById('classStatus').value, notes: document.getElementById('classNotes').value.trim() };
      if (id) {
        const index = state.classes.findIndex(item => item.id === id);
        if (index < 0) return toast('Class record was not found.', 'error');
        state.classes[index] = { ...state.classes[index], ...payload, updatedAt: new Date().toISOString() };
        toast('Class updated successfully.');
      } else {
        state.classes.push({ id: uid('cls'), ...payload, createdAt: new Date().toISOString() });
        toast('Class added successfully.');
      }
      saveData(id ? 'Updated class' : 'Created class', className); closeModal('classModal'); renderAll();
    }

    function deleteClass(id) {
      const item = getClassRecord(id);
      if (!item || !confirm(`Are you sure you want to delete the class "${item.className}"? Linked attendance records will also be deleted.`)) return;
      state.classes = state.classes.filter(record => record.id !== id);
      state.attendance = state.attendance.filter(record => record.classId !== id);
      saveData('Deleted class', item.className); renderAll(); toast('Class deleted successfully.');
    }

    function renderTimetable() {
      document.getElementById('timetableGrid').innerHTML = DAYS.map(day => {
        const classes = state.classes.filter(item => item.status === 'Active' && item.day === day).sort((a,b) => a.startTime.localeCompare(b.startTime));
        return `<div class="day-column" data-timetable-day="${day}"><h3>${day}</h3>${classes.length ? classes.map(item => `<div class="class-card"><h4>${esc(item.className)}</h4><p><strong>${esc(item.form)} · ${esc(item.subject)}</strong></p><p>${formatTime(item.startTime)} – ${formatTime(item.endTime)}</p><p>${(item.studentIds || []).filter(getStudent).length} Students</p><button class="btn btn-primary btn-sm" data-take-attendance="${item.id}">Take Attendance</button></div>`).join('') : '<div class="help">No active classes</div>'}</div>`;
      }).join('');
    }

    function switchAttendanceTab(tab) {
      document.querySelectorAll('[data-attendance-tab]').forEach(button => button.classList.toggle('active', button.dataset.attendanceTab === tab));
      document.getElementById('attendancePanelTake').classList.toggle('active', tab === 'take');
      document.getElementById('attendancePanelHistory').classList.toggle('active', tab === 'history');
      if (tab === 'history') { renderAttendanceHistoryFilters(); renderAttendanceHistory(); }
    }

    function renderAttendanceControls() {
      const select = document.getElementById('attendanceClass');
      const selected = select.value;
      const classes = state.classes.slice().sort((a,b) => a.className.localeCompare(b.className));
      select.innerHTML = '<option value="">Select class</option>' + classes.map(item => `<option value="${item.id}">${esc(item.className)}${item.status === 'Inactive' ? ' (Inactive)' : ''}</option>`).join('');
      if (classes.some(item => item.id === selected)) select.value = selected;
      renderAttendanceList();
    }

    function renderAttendanceList() {
      const classId = document.getElementById('attendanceClass').value;
      const date = document.getElementById('attendanceDate').value;
      const item = getClassRecord(classId);
      document.getElementById('attendanceForm').textContent = item?.form || '—';
      document.getElementById('attendanceSubject').textContent = item?.subject || '—';
      const container = document.getElementById('attendanceList');
      if (!item || !date) { container.innerHTML = '<div class="empty"><div class="empty-icon">✓</div><strong>Select an attendance date and class</strong><div>The class student list will appear automatically.</div></div>'; return; }
      const students = (item.studentIds || []).map(getStudent).filter(Boolean).sort((a,b) => a.studentName.localeCompare(b.studentName));
      if (!students.length) { container.innerHTML = '<div class="empty"><strong>No students assigned to this class</strong><div>Edit the class to add students.</div></div>'; return; }
      container.innerHTML = students.map(student => {
        const saved = state.attendance.find(record => record.studentId === student.id && record.classId === classId && record.attendanceDate === date);
        const savedReasonIsOther = saved?.reason && !ATTENDANCE_REASONS.slice(0,-1).includes(saved.reason);
        const reasonValue = savedReasonIsOther ? 'Other' : (saved?.reason || 'No Reason Given');
        const status = saved?.status || '';
        return `<div class="attendance-row" data-attendance-student="${student.id}"><div class="attendance-student"><strong>${esc(student.studentName)}</strong><span>${esc(student.form || 'Not set')} · ${esc(student.parentPhone || '')}</span></div><div class="status-options">${ATTENDANCE_STATUSES.map(option => `<label class="status-radio"><input type="radio" name="attendance_${student.id}" value="${option}" ${status === option ? 'checked' : ''}><span class="status-${option}">${option}</span></label>`).join('')}</div><div class="reason-fields"><div class="attendance-reason-group" ${status && status !== 'Present' ? '' : 'hidden'}><select class="attendance-reason">${ATTENDANCE_REASONS.map(reason => `<option ${reason === reasonValue ? 'selected' : ''}>${reason}</option>`).join('')}</select><input class="attendance-other-reason" maxlength="120" placeholder="Enter other reason" value="${savedReasonIsOther ? esc(saved.reason) : ''}" ${reasonValue === 'Other' ? '' : 'hidden'}></div><input class="attendance-notes" maxlength="300" placeholder="Attendance notes" value="${esc(saved?.notes || '')}"></div></div>`;
      }).join('');
      container.querySelectorAll('input[type="radio"]').forEach(input => input.addEventListener('change', () => updateAttendanceRow(input.closest('.attendance-row'))));
      container.querySelectorAll('.attendance-reason').forEach(selectReason => selectReason.addEventListener('change', () => updateAttendanceRow(selectReason.closest('.attendance-row'))));
    }

    function updateAttendanceRow(row) {
      const status = row.querySelector('input[type="radio"]:checked')?.value || '';
      const group = row.querySelector('.attendance-reason-group');
      group.hidden = !status || status === 'Present';
      const other = row.querySelector('.attendance-other-reason');
      other.hidden = row.querySelector('.attendance-reason').value !== 'Other';
    }

    function markAllPresent() {
      const rows = [...document.querySelectorAll('[data-attendance-student]')];
      if (!rows.length) return toast('Select a class with students first.', 'error');
      rows.forEach(row => { const input = row.querySelector('input[value="Present"]'); input.checked = true; updateAttendanceRow(row); });
      toast('All students marked Present.');
    }

    function saveAttendance() {
      const classId = document.getElementById('attendanceClass').value;
      const date = document.getElementById('attendanceDate').value;
      const rows = [...document.querySelectorAll('[data-attendance-student]')];
      if (!classId || !date || !rows.length) return toast('Select a date and class with students first.', 'error');
      if (rows.some(row => !row.querySelector('input[type="radio"]:checked'))) return toast('Please mark attendance for every student.', 'error');
      const wasExisting = state.attendance.some(record => record.classId === classId && record.attendanceDate === date);
      const now = new Date().toISOString();
      rows.forEach(row => {
        const studentId = row.dataset.attendanceStudent;
        const status = row.querySelector('input[type="radio"]:checked').value;
        const reasonSelect = row.querySelector('.attendance-reason');
        let reason = status === 'Present' ? '' : reasonSelect.value;
        if (reason === 'Other') reason = row.querySelector('.attendance-other-reason').value.trim() || 'Other';
        const payload = { studentId, classId, attendanceDate: date, status, reason, notes: row.querySelector('.attendance-notes').value.trim(), recordedAt: now };
        const existing = state.attendance.find(record => record.studentId === studentId && record.classId === classId && record.attendanceDate === date);
        if (existing) Object.assign(existing, payload);
        else state.attendance.push({ id: uid('att'), ...payload });
      });
      saveData(wasExisting ? 'Updated attendance' : 'Recorded attendance', `${getClassRecord(classId)?.className || 'Class'} · ${formatDate(date)}`); renderAll(); renderAttendanceList(); toast('Attendance saved successfully.');
    }

    function resetAttendance() {
      const rows = [...document.querySelectorAll('[data-attendance-student]')];
      if (!rows.length) return toast('Select a class with students first.', 'error');
      rows.forEach(row => { row.querySelectorAll('input[type="radio"]').forEach(input => input.checked = false); row.querySelector('.attendance-reason').value = 'No Reason Given'; row.querySelector('.attendance-other-reason').value = ''; row.querySelector('.attendance-notes').value = ''; updateAttendanceRow(row); });
      toast('Attendance form reset. Saved records are unchanged until you save again.');
    }

    function openAttendanceFor(classId, date = isoToday()) {
      navigate('attendance'); switchAttendanceTab('take');
      document.getElementById('attendanceDate').value = date;
      renderAttendanceControls();
      document.getElementById('attendanceClass').value = classId;
      renderAttendanceList();
    }

    function printAttendanceList() {
      const classRecord = getClassRecord(document.getElementById('attendanceClass').value);
      const date = document.getElementById('attendanceDate').value;
      const rows = [...document.querySelectorAll('[data-attendance-student]')];
      if (!classRecord || !date || !rows.length) return toast('Select a date and class with students first.', 'error');
      const body = rows.map((row,index) => { const student = getStudent(row.dataset.attendanceStudent); const status = row.querySelector('input[type="radio"]:checked')?.value || ''; const reasonSelect = row.querySelector('.attendance-reason'); let reason = status === 'Present' ? '' : reasonSelect.value; if (reason === 'Other') reason = row.querySelector('.attendance-other-reason').value.trim(); return `<tr><td>${index + 1}</td><td>${esc(student?.studentName || '')}</td><td>${esc(student?.form || '')}</td><td>${esc(status)}</td><td>${esc(reason)}</td><td>${esc(row.querySelector('.attendance-notes').value)}</td></tr>`; }).join('');
      document.getElementById('attendancePrintArea').innerHTML = `<h1>Teacher VENUS Attendance List</h1><p><strong>${esc(classRecord.className)}</strong> · ${esc(classRecord.form)} · ${esc(classRecord.subject)}</p><p>${formatDate(date)} · ${esc(classRecord.day)} · ${formatTime(classRecord.startTime)} – ${formatTime(classRecord.endTime)}</p><table><thead><tr><th>#</th><th>Student Name</th><th>Form</th><th>Status</th><th>Reason</th><th>Notes</th></tr></thead><tbody>${body}</tbody></table>`;
      document.body.classList.add('printing-attendance');
      const cleanup = () => document.body.classList.remove('printing-attendance');
      window.addEventListener('afterprint', cleanup, { once: true }); window.print(); setTimeout(cleanup,1200);
    }

    function fillSelect(id, options, allLabel) {
      const select = document.getElementById(id); const selected = select.value;
      select.innerHTML = `<option value="all">${allLabel}</option>` + options.map(option => `<option value="${esc(option.value)}">${esc(option.label)}</option>`).join('');
      if ([...select.options].some(option => option.value === selected)) select.value = selected;
    }

    function renderAttendanceHistoryFilters() {
      fillSelect('attendanceHistoryStudent', state.students.slice().sort((a,b) => a.studentName.localeCompare(b.studentName)).map(student => ({value:student.id,label:student.studentName})), 'All students');
      fillSelect('attendanceHistoryClass', state.classes.slice().sort((a,b) => a.className.localeCompare(b.className)).map(item => ({value:item.id,label:item.className})), 'All classes');
      fillSelect('attendanceHistorySubject', [...new Set(state.classes.map(item => item.subject).filter(Boolean))].sort().map(subject => ({value:subject,label:subject})), 'All subjects');
    }

    function filteredAttendance() {
      const studentId = document.getElementById('attendanceHistoryStudent').value;
      const form = document.getElementById('attendanceHistoryForm').value;
      const classId = document.getElementById('attendanceHistoryClass').value;
      const subject = document.getElementById('attendanceHistorySubject').value;
      const date = document.getElementById('attendanceHistoryDate').value;
      const month = document.getElementById('attendanceHistoryMonth').value;
      const status = document.getElementById('attendanceHistoryStatus').value;
      return state.attendance.filter(record => {
        const student = getStudent(record.studentId); const classRecord = getClassRecord(record.classId);
        return (studentId === 'all' || record.studentId === studentId) && (form === 'all' || student?.form === form) && (classId === 'all' || record.classId === classId) && (subject === 'all' || classRecord?.subject === subject) && (!date || record.attendanceDate === date) && (!month || (record.attendanceDate || '').slice(0,7) === month) && (status === 'all' || record.status === status);
      }).sort((a,b) => (b.attendanceDate || '').localeCompare(a.attendanceDate || '') || (b.recordedAt || '').localeCompare(a.recordedAt || ''));
    }

    function renderAttendanceHistory() {
      const records = filteredAttendance();
      document.getElementById('attendanceHistoryBody').innerHTML = records.length ? records.map(record => {
        const student = getStudent(record.studentId); const classRecord = getClassRecord(record.classId);
        return `<tr><td>${formatDate(record.attendanceDate)}</td><td><button class="name-link" data-student-history="${record.studentId}">${esc(student?.studentName || 'Unknown student')}</button></td><td>${esc(student?.form || '—')}</td><td>${esc(classRecord?.className || 'Deleted class')}</td><td>${esc(classRecord?.subject || '—')}</td><td><span class="badge ${statusClass(record.status)}">${esc(record.status)}</span></td><td>${esc(record.reason || '—')}</td><td>${esc(record.notes || '—')}</td><td><button class="btn btn-secondary btn-sm" data-edit-attendance="${record.id}">Edit</button></td><td><button class="btn btn-danger btn-sm" data-delete-attendance="${record.id}">Delete</button></td></tr>`;
      }).join('') : emptyRow(10, 'No attendance records found', state.attendance.length ? 'Try changing the attendance filters.' : 'Saved attendance will appear here.');
    }

    function editAttendanceRecord(id) {
      const record = state.attendance.find(item => item.id === id);
      if (!record || !getClassRecord(record.classId)) return toast('Attendance or class record was not found.', 'error');
      openAttendanceFor(record.classId, record.attendanceDate);
    }

    function deleteAttendanceRecord(id) {
      const record = state.attendance.find(item => item.id === id);
      if (!record || !confirm('Delete this attendance record?')) return;
      state.attendance = state.attendance.filter(item => item.id !== id);
      saveData('Deleted attendance', `${getStudent(record.studentId)?.studentName || 'Student'} · ${formatDate(record.attendanceDate)}`); renderAll(); toast('Attendance record deleted successfully.');
    }

    function clearAttendanceFilters() {
      document.getElementById('attendanceHistoryStudent').value = 'all';
      document.getElementById('attendanceHistoryForm').value = 'all';
      document.getElementById('attendanceHistoryClass').value = 'all';
      document.getElementById('attendanceHistorySubject').value = 'all';
      document.getElementById('attendanceHistoryDate').value = '';
      document.getElementById('attendanceHistoryMonth').value = '';
      document.getElementById('attendanceHistoryStatus').value = 'all';
      renderAttendanceHistory();
    }

    function exportAttendanceCsv() {
      const rows = [['Date','Student Name','Form','Class','Subject','Attendance Status','Reason','Notes']];
      filteredAttendance().forEach(record => { const student = getStudent(record.studentId); const classRecord = getClassRecord(record.classId); rows.push([formatDate(record.attendanceDate), student?.studentName || '', student?.form || '', classRecord?.className || '', classRecord?.subject || '', record.status, record.reason, record.notes]); });
      downloadFile(`attendance-records-${isoToday()}.csv`, '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
      toast('Attendance records exported successfully.');
    }

    // ---------- Fee adjustments ----------
    function updateAdjustmentDescriptionOptions(selected = '') {
      const type = document.getElementById('adjustmentType').value;
      const select = document.getElementById('adjustmentDescription');
      select.innerHTML = ADJUSTMENT_OPTIONS[type].map(item => `<option${item === selected ? ' selected' : ''}>${esc(item)}</option>`).join('');
      updateAdjustmentOtherVisibility();
    }

    function updateAdjustmentOtherVisibility() {
      const isOther = document.getElementById('adjustmentDescription').value === 'Other';
      document.getElementById('adjustmentOtherWrap').classList.toggle('visible', isOther);
      document.getElementById('adjustmentOther').required = isOther;
    }

    function resetAdjustmentForm() {
      document.getElementById('adjustmentForm').reset();
      document.getElementById('adjustmentEditId').value = '';
      document.getElementById('adjustmentType').value = 'Additional Charge';
      updateAdjustmentDescriptionOptions();
      document.getElementById('adjustmentDate').value = isoToday();
      document.getElementById('saveAdjustmentBtn').textContent = 'Add Adjustment';
      document.getElementById('cancelAdjustmentEditBtn').hidden = true;
    }

    function openAdjustmentForm(studentId, key) {
      const row = getMonthRow(studentId, key);
      if (!row) return toast('Monthly fee record was not found.', 'error');
      document.getElementById('adjustmentStudentId').value = studentId;
      document.getElementById('adjustmentMonthKey').value = key;
      document.getElementById('adjustmentModalTitle').textContent = `${row.student.studentName} · ${monthLabel(key)} Fee Adjustment`;
      resetAdjustmentForm();
      renderAdjustmentModal();
      openModal('adjustmentModal');
    }

    function renderAdjustmentModal() {
      const studentId = document.getElementById('adjustmentStudentId').value;
      const key = document.getElementById('adjustmentMonthKey').value;
      const row = getMonthRow(studentId, key);
      if (!row) return;
      document.getElementById('adjustmentFeeSummary').innerHTML = feeSummaryMarkup(row);
      const items = state.feeAdjustments.filter(item => item.studentId === studentId && item.monthKey === key).sort((a,b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
      document.getElementById('adjustmentHistoryBody').innerHTML = items.length ? items.map(item => `<tr><td>${formatDate(item.date)}</td><td>${esc(item.adjustmentType)}</td><td>${esc(item.description)}</td><td class="${item.adjustmentType === 'Additional Charge' ? 'money-plus' : 'money-minus'}">${item.adjustmentType === 'Additional Charge' ? '+' : '−'} ${money(item.amount)}</td><td><span class="badge ${item.voided ? 'badge-voided' : 'badge-active'}">${item.voided ? 'Voided' : 'Active'}</span></td><td>${esc(item.notes || '—')}</td><td>${item.voided ? '—' : `<div class="actions"><button class="btn btn-secondary btn-sm" data-edit-adjustment="${item.id}">Edit</button><button class="btn btn-danger btn-sm" data-void-adjustment="${item.id}">Void</button></div>`}</td></tr>`).join('') : emptyRow(7,'No fee adjustments','Add an Additional Charge or Discount above.');
    }

    function paidMonthWarning(studentId, key) {
      const hasPayments = state.payments.some(payment => !payment.voided && payment.studentId === studentId && paymentMonthKey(payment) === key);
      return !hasPayments || confirm('This month already has payment records. Changing the fee may change its outstanding balance. Existing receipt snapshots will remain unchanged. Continue?');
    }

    function editAdjustment(id) {
      const item = state.feeAdjustments.find(record => record.id === id);
      if (!item || item.voided) return toast('This adjustment cannot be edited.', 'error');
      document.getElementById('adjustmentEditId').value = item.id;
      document.getElementById('adjustmentType').value = item.adjustmentType;
      const known = ADJUSTMENT_OPTIONS[item.adjustmentType].includes(item.description);
      updateAdjustmentDescriptionOptions(known ? item.description : 'Other');
      document.getElementById('adjustmentOther').value = known ? '' : item.description;
      document.getElementById('adjustmentAmount').value = Number(item.amount).toFixed(2);
      document.getElementById('adjustmentDate').value = item.date;
      document.getElementById('adjustmentNotes').value = item.notes || '';
      document.getElementById('saveAdjustmentBtn').textContent = 'Save Adjustment';
      document.getElementById('cancelAdjustmentEditBtn').hidden = false;
    }

    function saveAdjustment(event) {
      event.preventDefault();
      const studentId = document.getElementById('adjustmentStudentId').value;
      const key = document.getElementById('adjustmentMonthKey').value;
      const editId = document.getElementById('adjustmentEditId').value;
      const type = document.getElementById('adjustmentType').value;
      const selectedDescription = document.getElementById('adjustmentDescription').value;
      const description = selectedDescription === 'Other' ? document.getElementById('adjustmentOther').value.trim() : selectedDescription;
      const amount = roundMoney(document.getElementById('adjustmentAmount').value);
      const date = document.getElementById('adjustmentDate').value;
      const notes = document.getElementById('adjustmentNotes').value.trim();
      if (!getMonthRow(studentId,key) || !description || !date) return toast('Please complete all required adjustment fields.', 'error');
      if (!Number.isFinite(amount) || amount <= 0) return toast('Adjustment amount must be greater than RM0.00.', 'error');
      if (!paidMonthWarning(studentId,key)) return;
      const now = new Date().toISOString();
      const actor = currentSession?.user?.id || null;
      if (editId) {
        const item = state.feeAdjustments.find(record => record.id === editId);
        if (!item || item.voided) return toast('This adjustment is unavailable for editing.', 'error');
        Object.assign(item,{ adjustmentType:type, description, amount, date, notes, updatedAt:now, updatedBy:actor });
      } else {
        state.feeAdjustments.push({ id:uid('adj'), studentId, monthKey:key, adjustmentType:type, description, amount, date, notes, voided:false, createdAt:now, createdBy:actor, updatedAt:now, updatedBy:actor });
      }
      saveData(editId ? 'Updated fee adjustment' : 'Added fee adjustment', `${getStudent(studentId)?.studentName || 'Student'} · ${monthLabel(key)} · ${description}`);
      resetAdjustmentForm(); renderAdjustmentModal(); renderAll();
      toast(editId ? 'Fee adjustment updated successfully.' : 'Fee adjustment added successfully.');
    }

    function voidAdjustment(id) {
      const item = state.feeAdjustments.find(record => record.id === id);
      if (!item || item.voided || !confirm(`Void ${item.description} ${money(item.amount)}? The adjustment will remain in history.`)) return;
      if (!paidMonthWarning(item.studentId,item.monthKey)) return;
      const now = new Date().toISOString();
      const actor = currentSession?.user?.id || null;
      Object.assign(item,{ voided:true, voidedAt:now, voidedBy:actor, updatedAt:now, updatedBy:actor });
      saveData('Voided fee adjustment', `${getStudent(item.studentId)?.studentName || 'Student'} · ${item.description}`);
      renderAdjustmentModal(); renderAll(); toast('Fee adjustment voided successfully.');
    }

    // ---------- Payments, receipts and reminders ----------
    async function reserveReceiptNumber(dateIso) {
      if (!sb || !currentWorkspaceId || !currentSession) throw new Error('Cloud connection is required to issue a secure receipt number.');
      const { data, error } = await sb.rpc('reserve_receipt_number', { p_workspace_id: currentWorkspaceId, p_payment_date: dateIso });
      if (error) throw error;
      if (!/^\d{6}-\d{3,}$/.test(String(data || ''))) throw new Error('The database returned an invalid receipt number.');
      return String(data);
    }

    function openPaymentForm(studentId, key) {
      const row = getMonthRow(studentId, key);
      if (!row) return toast('Monthly fee record was not found.', 'error');
      document.getElementById('paymentForm').reset();
      document.getElementById('paymentEditId').value = '';
      document.getElementById('paymentModalTitle').textContent = 'Record Payment';
      document.getElementById('savePaymentBtn').textContent = 'Record Payment';
      document.getElementById('paymentStudentId').value = studentId;
      document.getElementById('paymentForm').dataset.month = key;
      document.getElementById('paymentStudentName').textContent = row.student.studentName;
      document.getElementById('paymentMonthText').textContent = monthLabel(key);
      document.getElementById('paymentExpected').textContent = money(row.expected);
      document.getElementById('paymentAlreadyPaid').textContent = `${money(row.paid)} · Balance ${money(row.balance)}`;
      document.getElementById('paymentFeeBreakdown').innerHTML = feeSummaryMarkup(row);
      document.getElementById('paymentAmount').value = row.balance > 0 ? row.balance.toFixed(2) : '';
      document.getElementById('paymentDate').value = isoToday();
      document.getElementById('paymentMethod').value = 'Cash';
      document.getElementById('paymentBankName').value = state.settings.defaultBankName || '';
      document.getElementById('paymentDescription').value = '';
      renderPaymentMethodFields();
      openModal('paymentModal');
    }

    function openEditPayment(paymentId) {
      const payment = state.payments.find(item => item.id === paymentId);
      if (!payment || payment.voided) return toast('This payment cannot be edited.', 'error');
      const key = paymentMonthKey(payment); const row = getMonthRow(payment.studentId,key); const student = getStudent(payment.studentId);
      if (!row || !student) return toast('Payment details are unavailable.', 'error');
      document.getElementById('paymentForm').reset();
      document.getElementById('paymentEditId').value = payment.id;
      document.getElementById('paymentStudentId').value = payment.studentId;
      document.getElementById('paymentForm').dataset.month = key;
      document.getElementById('paymentModalTitle').textContent = `Edit Payment · ${payment.receiptNumber}`;
      document.getElementById('savePaymentBtn').textContent = 'Save Changes';
      document.getElementById('paymentStudentName').textContent = student.studentName;
      document.getElementById('paymentMonthText').textContent = monthLabel(key);
      document.getElementById('paymentExpected').textContent = money(row.expected);
      document.getElementById('paymentAlreadyPaid').textContent = `${money(row.paid)} total before changes`;
      document.getElementById('paymentFeeBreakdown').innerHTML = feeSummaryMarkup(row);
      document.getElementById('paymentAmount').value = Number(payment.amount).toFixed(2);
      document.getElementById('paymentDate').value = payment.paymentDate;
      document.getElementById('paymentMethod').value = payment.paymentMethod;
      document.getElementById('paymentLessons').value = payment.numberOfLessons || '';
      document.getElementById('paymentDescription').value = payment.paymentDescription || '';
      document.getElementById('paymentBankName').value = payment.bankName || state.settings.defaultBankName || '';
      document.getElementById('paymentReference').value = payment.referenceNumber || '';
      document.getElementById('paymentTransferDate').value = payment.transferDate || '';
      document.getElementById('paymentTngReference').value = payment.referenceNumber || '';
      document.getElementById('paymentTngDate').value = payment.transferDate || payment.paymentDate || '';
      document.getElementById('paymentNotes').value = payment.notes || '';
      renderPaymentMethodFields();
      openModal('paymentModal');
    }

    function renderPaymentMethodFields() {
      const method = document.getElementById('paymentMethod').value;
      document.getElementById('bankFields').classList.toggle('visible', method === 'Bank Transfer' || method === 'DuitNow');
      document.getElementById('tngFields').classList.toggle('visible', method === 'Touch ‘n Go');
    }

    function paymentDetailValues(method) {
      if (method === 'Bank Transfer' || method === 'DuitNow') return {
        bankName: document.getElementById('paymentBankName').value.trim(),
        referenceNumber: document.getElementById('paymentReference').value.trim(),
        transferDate: document.getElementById('paymentTransferDate').value || null
      };
      if (method === 'Touch ‘n Go') return {
        bankName: '',
        referenceNumber: document.getElementById('paymentTngReference').value.trim(),
        transferDate: document.getElementById('paymentTngDate').value || null
      };
      return { bankName:'', referenceNumber:'', transferDate:null };
    }

    function buildReceiptSnapshot(payment, row) {
      const student = row.student;
      const otherPaid = state.payments.filter(item => !item.voided && item.id !== payment.id && item.studentId === payment.studentId && paymentMonthKey(item) === paymentMonthKey(payment)).reduce((sum,item) => sum + Number(item.amount || 0), 0);
      const totalPaidToDate = roundMoney(otherPaid + Number(payment.amount || 0));
      return {
        receiptNumber: payment.receiptNumber,
        studentName: student.studentName,
        parentContactNumber: student.parentPhone,
        studentForm: student.form,
        paymentMonth: monthLabel(paymentMonthKey(payment)),
        subjects: (row.record.subjects || []).map(item => `${student.form ? `${student.form} ` : ''}${item.name}`.trim()),
        numberOfLessons: payment.numberOfLessons || null,
        paymentDescription: payment.paymentDescription || '',
        baseTuitionFee: row.baseFee,
        additionalCharges: row.additionalCharges,
        discounts: row.discounts,
        adjustments: row.adjustments.map(item => ({ type:item.adjustmentType, description:item.description, amount:Number(item.amount) })),
        finalExpectedAmount: row.expected,
        amountPaidThisTime: Number(payment.amount),
        totalPaidToDate,
        remainingBalance: roundMoney(Math.max(0,row.expected - totalPaidToDate)),
        paymentMethod: payment.paymentMethod,
        bankName: payment.bankName || '',
        referenceNumber: payment.referenceNumber || '',
        paymentDate: payment.paymentDate,
        transferDate: payment.transferDate || null,
        receiptFooterName: state.settings.receiptFooterName || DEFAULT_SETTINGS.receiptFooterName,
        teacherDisplayName: state.settings.teacherDisplayName || DEFAULT_SETTINGS.teacherDisplayName,
        notes: payment.notes || ''
      };
    }

    async function savePayment(event) {
      event.preventDefault();
      if (paymentSubmitting) return;
      const button = document.getElementById('savePaymentBtn');
      const editId = document.getElementById('paymentEditId').value;
      const studentId = document.getElementById('paymentStudentId').value;
      const key = document.getElementById('paymentForm').dataset.month;
      const paymentDate = document.getElementById('paymentDate').value;
      const amount = roundMoney(document.getElementById('paymentAmount').value);
      const method = document.getElementById('paymentMethod').value;
      const row = getMonthRow(studentId, key);
      if (!getStudent(studentId) || !row) return toast('Student or monthly record was not found.', 'error');
      if (!paymentDate || !key || !method) return toast('Please complete all required fields.', 'error');
      if (!Number.isFinite(amount) || amount <= 0) return toast('Payment amount must be greater than RM0.00.', 'error');
      paymentSubmitting = true; button.disabled = true;
      button.textContent = editId ? 'Saving…' : 'Issuing secure receipt…';
      try {
        const { year, month } = parseMonthKey(key);
        const details = paymentDetailValues(method);
        const numberOfLessons = Number(document.getElementById('paymentLessons').value) || null;
        const paymentDescription = document.getElementById('paymentDescription').value.trim();
        const notes = document.getElementById('paymentNotes').value.trim();
        const now = new Date().toISOString();
        const actor = currentSession?.user?.id || null;
        let payment;
        if (editId) {
          payment = state.payments.find(item => item.id === editId);
          if (!payment || payment.voided) return toast('Payment is unavailable for editing.', 'error');
          if (!confirm('Editing a paid transaction will update this receipt snapshot. Continue?')) return;
          Object.assign(payment,{paymentDate,amount,paymentMethod:method,numberOfLessons,paymentDescription,notes,...details,updatedAt:now,updatedBy:actor});
        } else {
          const receiptNumber = await reserveReceiptNumber(paymentDate);
          payment = { id:uid('pay'),receiptNumber,studentId,paymentMonth:month,paymentYear:year,paymentDate,amount,paymentMethod:method,numberOfLessons,paymentDescription,notes,...details,voided:false,createdAt:now,createdBy:actor,updatedAt:now,updatedBy:actor };
          state.payments.push(payment);
        }
        payment.receiptSnapshot = buildReceiptSnapshot(payment,row);
        saveData(editId ? 'Updated payment' : 'Recorded payment', `${getStudent(studentId)?.studentName || 'Student'} · ${payment.receiptNumber}`); closeModal('paymentModal'); renderAll();
        toast(editId ? 'Payment updated successfully.' : 'Payment recorded successfully.');
        showReceipt(payment.id);
      } catch (error) {
        console.error('Payment save failed', error);
        toast(`Payment was not recorded: ${error.message || 'Unable to issue receipt number.'}`, 'error');
      } finally {
        setTimeout(() => { paymentSubmitting = false; button.disabled = false; button.textContent = editId ? 'Save Changes' : 'Record Payment'; }, 450);
      }
    }

    function receiptMarkup(payment) {
      let snapshot = payment.receiptSnapshot;
      if (!snapshot || !snapshot.studentName) {
        const row = getMonthRow(payment.studentId,paymentMonthKey(payment));
        if (!row) return '<div class="empty">Receipt snapshot is unavailable.</div>';
        snapshot = buildReceiptSnapshot(payment,row);
      }
      const formatReceiptDate = value => formatDate(value).replaceAll('/',' – ');
      const forText = snapshot.paymentDescription || (snapshot.numberOfLessons ? `${snapshot.numberOfLessons} Lessons` : snapshot.paymentMonth);
      const adjustmentMarkup = (snapshot.adjustments || []).length ? `<div class="receipt-adjustments"><h4>ADJUSTMENTS</h4>${snapshot.adjustments.map(item => `<div class="receipt-adjustment-row"><span>${esc(item.description)}</span><strong class="${item.type === 'Additional Charge' ? 'money-plus' : 'money-minus'}">${item.type === 'Additional Charge' ? '+' : '−'} ${money(item.amount)}</strong></div>`).join('')}</div>` : '';
      const bankValue = ['Bank Transfer','DuitNow'].includes(snapshot.paymentMethod) ? [snapshot.bankName,snapshot.referenceNumber,snapshot.transferDate ? `(${formatDate(snapshot.transferDate)})` : ''].filter(Boolean).join(' ') : '';
      const cashValue = snapshot.paymentMethod === 'Cash' ? money(snapshot.amountPaidThisTime) : '';
      const tngValue = snapshot.paymentMethod === 'Touch ‘n Go' ? [snapshot.referenceNumber,snapshot.transferDate ? `(${formatDate(snapshot.transferDate)})` : ''].filter(Boolean).join(' ') : '';
      const otherValue = snapshot.paymentMethod === 'Other' ? `${snapshot.paymentMethod} ${snapshot.referenceNumber || ''}`.trim() : '';
      return `<div class="receipt-frame">
        <div class="receipt-header"><span>RECEIPT</span><span>RECEIPT NO : ${esc(snapshot.receiptNumber)}</span></div>
        <table class="receipt-table"><tbody>
          <tr><th>RECEIVED FROM</th><td>${esc(snapshot.studentName)}</td><th>DATE</th><td>${formatReceiptDate(snapshot.paymentDate)}</td></tr>
          <tr><th>CONTACT NUMBER</th><td colspan="3">${esc(snapshot.parentContactNumber || '—')}</td></tr>
          <tr><th>TOTAL (RM)</th><td>${Number(snapshot.amountPaidThisTime || 0).toFixed(2)}</td><th>FOR</th><td>${esc(forText)}</td></tr>
        </tbody></table>
        <div class="receipt-main-grid"><div><table class="receipt-table"><tbody><tr><th>MONTH</th><td>${esc(String(snapshot.paymentMonth || '').toUpperCase())}</td></tr><tr><th>SUBJECTS</th><td class="receipt-subjects">${esc((snapshot.subjects || []).join('\n') || '—')}</td></tr></tbody></table>${adjustmentMarkup}</div>
        <div><table class="receipt-table"><tbody><tr><th>BANK</th><td>${esc(bankValue)}</td></tr><tr><th>CASH</th><td>${esc(cashValue)}</td></tr><tr><th>TNG</th><td>${esc(tngValue)}</td></tr>${otherValue ? `<tr><th>OTHER</th><td>${esc(otherValue)}</td></tr>` : ''}</tbody></table>
        <div class="receipt-payment-summary"><div><span>Final Expected</span><strong>${money(snapshot.finalExpectedAmount)}</strong></div><div><span>Paid This Time</span><strong>${money(snapshot.amountPaidThisTime)}</strong></div><div><span>Total Paid To Date</span><strong>${money(snapshot.totalPaidToDate)}</strong></div><div><span>Remaining Balance</span><strong>${money(snapshot.remainingBalance)}</strong></div></div></div></div>
        <div class="receipt-footer">BY: ${esc(snapshot.receiptFooterName || DEFAULT_SETTINGS.receiptFooterName)}</div>
        ${payment.voided ? '<div class="receipt-void">VOID</div>' : ''}
      </div>`;
    }

    function showReceipt(paymentId) {
      const payment = state.payments.find(item => item.id === paymentId);
      if (!payment) return toast('Receipt was not found.', 'error');
      activeReceiptId = paymentId;
      document.getElementById('receiptPrintArea').innerHTML = receiptMarkup(payment);
      openModal('receiptModal');
    }

    function printReceipt() {
      if (!activeReceiptId) return;
      document.body.classList.add('printing-receipt');
      const cleanup = () => document.body.classList.remove('printing-receipt');
      window.addEventListener('afterprint', cleanup, { once: true });
      window.print();
      setTimeout(cleanup, 1200);
    }

    function reprintReceipt(paymentId) {
      showReceipt(paymentId);
      setTimeout(printReceipt, 120);
    }

    function normalizeMalaysiaPhone(phone) {
      let digits = String(phone || '').replace(/\D/g, '');
      if (digits.startsWith('00')) digits = digits.slice(2);
      if (digits.startsWith('0')) digits = `60${digits.slice(1)}`;
      else if (!digits.startsWith('60')) digits = `60${digits}`;
      return digits;
    }

    function openReminder(studentId, key) {
      const row = getMonthRow(studentId, key);
      if (!row) return toast('Monthly fee record was not found.', 'error');
      const label = monthLabel(key);
      const message = `Hello, this is a friendly reminder that the tuition fee for ${label} has not been fully paid.\n\nStudent: ${row.student.studentName}\nTotal Fee: ${money(row.expected)}\nAmount Paid: ${money(row.paid)}\nOutstanding Balance: ${money(row.balance)}\n\nThank you.\n\n您好，温馨提醒，${label} 的补习学费还未缴清。\n\n学生姓名：${row.student.studentName}\n本月学费：${money(row.expected)}\n已付款：${money(row.paid)}\n未付款余额：${money(row.balance)}\n\n谢谢。`;
      document.getElementById('reminderMessage').value = message;
      document.getElementById('reminderPhone').value = normalizeMalaysiaPhone(row.student.parentPhone);
      openModal('reminderModal');
    }

    async function copyReminder() {
      const area = document.getElementById('reminderMessage');
      try {
        await navigator.clipboard.writeText(area.value);
      } catch (error) {
        area.select();
        document.execCommand('copy');
      }
      toast('Reminder message copied.');
    }

    function openWhatsApp() {
      const phone = document.getElementById('reminderPhone').value;
      const message = document.getElementById('reminderMessage').value;
      if (!phone) return toast('Parent phone number is invalid.', 'error');
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
    }

    // ---------- Transaction history and per-student summary ----------
    function renderHistoryFilters() {
      const studentSelect = document.getElementById('historyStudent');
      const selectedStudent = studentSelect.value;
      studentSelect.innerHTML = '<option value="all">All students</option>' + state.students.slice().sort((a,b) => a.studentName.localeCompare(b.studentName)).map(student => `<option value="${student.id}">${esc(student.studentName)}</option>`).join('');
      if ([...studentSelect.options].some(option => option.value === selectedStudent)) studentSelect.value = selectedStudent;

      const monthSelect = document.getElementById('historyMonth');
      const selectedMonth = monthSelect.value;
      monthSelect.innerHTML = '<option value="all">All months</option>' + MONTH_NAMES.map((name,index) => `<option value="${index + 1}">${name}</option>`).join('');
      if ([...monthSelect.options].some(option => option.value === selectedMonth)) monthSelect.value = selectedMonth;

      const yearSelect = document.getElementById('historyYear');
      const selectedYear = yearSelect.value;
      const years = [...new Set(state.payments.map(payment => Number(payment.paymentYear)))].filter(Boolean).sort((a,b) => b-a);
      yearSelect.innerHTML = '<option value="all">All years</option>' + years.map(year => `<option>${year}</option>`).join('');
      if ([...yearSelect.options].some(option => option.value === selectedYear)) yearSelect.value = selectedYear;
    }

    function transactionStatus(payment) {
      if (payment.voided) return 'Voided';
      const row = getMonthRow(payment.studentId, paymentMonthKey(payment));
      return row?.status || 'Unpaid';
    }

    function filteredPayments() {
      const query = document.getElementById('historySearch').value.trim().toLowerCase();
      const studentId = document.getElementById('historyStudent').value;
      const month = document.getElementById('historyMonth').value;
      const year = document.getElementById('historyYear').value;
      const method = document.getElementById('historyMethod').value;
      const status = document.getElementById('historyStatus').value;
      return state.payments.filter(payment => {
        const student = getStudent(payment.studentId);
        const haystack = `${payment.receiptNumber} ${student?.studentName || ''} ${payment.notes || ''}`.toLowerCase();
        return (!query || haystack.includes(query)) &&
          (studentId === 'all' || payment.studentId === studentId) &&
          (month === 'all' || Number(payment.paymentMonth) === Number(month)) &&
          (year === 'all' || Number(payment.paymentYear) === Number(year)) &&
          (method === 'all' || payment.paymentMethod === method) &&
          (status === 'all' || transactionStatus(payment) === status);
      }).sort((a,b) => (b.paymentDate || '').localeCompare(a.paymentDate || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
    }

    function renderHistory() {
      const payments = filteredPayments();
      document.getElementById('historyBody').innerHTML = payments.length ? payments.map(payment => {
        const student = getStudent(payment.studentId);
        const status = transactionStatus(payment);
        return `<tr><td><strong>${esc(payment.receiptNumber)}</strong></td><td><button class="name-link" data-student-history="${payment.studentId}">${esc(payment.receiptSnapshot?.studentName || student?.studentName || 'Deleted student')}</button></td><td>${esc(monthLabel(paymentMonthKey(payment)))}</td><td>${formatDate(payment.paymentDate)}</td><td class="money">${money(payment.amount)}</td><td>${esc(payment.paymentMethod)}</td><td><span class="badge ${statusClass(status)}">${status}</span></td><td>${esc(payment.notes || '—')}</td><td><div class="actions"><button class="btn btn-secondary btn-sm" data-receipt="${payment.id}">View Receipt</button><button class="btn btn-secondary btn-sm" data-reprint-receipt="${payment.id}">Print / Reprint</button>${payment.voided ? '' : `<button class="btn btn-secondary btn-sm" data-edit-payment="${payment.id}">Edit</button>`}</div></td><td>${payment.voided ? '—' : `<button class="btn btn-danger btn-sm" data-delete-payment="${payment.id}">Void Receipt</button>`}</td></tr>`;
      }).join('') : emptyRow(10, 'No payment transactions found', state.payments.length ? 'Try changing your search or filters.' : 'Recorded payments will appear here.');
    }

    function deletePayment(id) {
      const payment = state.payments.find(item => item.id === id);
      if (!payment || payment.voided || !confirm(`Void payment ${payment.receiptNumber}? The receipt will remain in Audit Logs and Payment History.`)) return;
      payment.voided = true; payment.voidedAt = new Date().toISOString(); payment.voidedBy = currentSession?.user?.id || null; payment.updatedAt = new Date().toISOString();
      saveData('Voided payment', payment.receiptNumber); renderAll(); toast('Payment voided successfully.');
    }

    function showStudentHistory(studentId) {
      const student = getStudent(studentId);
      if (!student) return toast('Student record was not found.', 'error');
      const recordKeys = Object.values(state.monthlyRecords).filter(record => record.studentId === studentId).map(record => record.monthKey);
      const paymentKeys = state.payments.filter(payment => payment.studentId === studentId).map(paymentMonthKey);
      const keys = [...new Set([...recordKeys, ...paymentKeys])].sort((a,b) => b.localeCompare(a));
      const rows = keys.map(key => getMonthRow(studentId, key)).filter(Boolean);
      const attendance = state.attendance.filter(record => record.studentId === studentId).sort((a,b) => b.attendanceDate.localeCompare(a.attendanceDate));
      const counts = Object.fromEntries(ATTENDANCE_STATUSES.map(status => [status, attendance.filter(record => record.status === status).length]));
      const rate = attendance.length ? counts.Present / attendance.length * 100 : 0;
      document.getElementById('studentHistoryTitle').textContent = `${student.studentName} · Student Record`;
      document.getElementById('studentAttTotal').textContent = attendance.length;
      document.getElementById('studentAttPresent').textContent = counts.Present;
      document.getElementById('studentAttAbsent').textContent = counts.Absent;
      document.getElementById('studentAttLate').textContent = counts.Late;
      document.getElementById('studentAttExcused').textContent = counts.Excused;
      document.getElementById('studentAttRate').textContent = `${rate.toFixed(1)}%`;
      document.getElementById('studentAttendanceHistoryBody').innerHTML = attendance.length ? attendance.map(record => { const classRecord = getClassRecord(record.classId); return `<tr><td>${formatDate(record.attendanceDate)}</td><td>${esc(classRecord?.className || 'Deleted class')}</td><td>${esc(classRecord?.subject || '—')}</td><td><span class="badge ${statusClass(record.status)}">${esc(record.status)}</span></td><td>${esc(record.reason || '—')}</td><td>${esc(record.notes || '—')}</td></tr>`; }).join('') : emptyRow(6, 'No attendance records yet');
      document.getElementById('studentHistorySummaryBody').innerHTML = rows.length ? rows.map(row => `<tr><td>${esc(monthLabel(row.record.monthKey))}</td><td class="money">${money(row.expected)}</td><td class="money">${money(row.paid)}</td><td class="money">${money(row.balance)}</td><td><span class="badge ${statusClass(row.status)}">${row.status}</span></td></tr>`).join('') : emptyRow(5, 'No monthly records yet');
      openModal('studentHistoryModal');
    }

    // ---------- Backup, CSV export and sample records ----------
    function downloadFile(filename, content, type) {
      const blob = new Blob([content], { type });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function exportBackup() {
      const backup = { app: 'Teacher VENUS Tuition Fee Management System', exportedAt: new Date().toISOString(), data: state };
      downloadFile(`tuition-backup-${isoToday()}.json`, JSON.stringify(backup, null, 2), 'application/json;charset=utf-8');
      toast('Backup exported successfully.');
    }

    function validImportedData(candidate) {
      if (!candidate || typeof candidate !== 'object' || !Array.isArray(candidate.students) || !Array.isArray(candidate.payments)) return false;
      if (candidate.students.some(student => !student.id || !student.studentName || !Array.isArray(student.subjects))) return false;
      if (candidate.payments.some(payment => !payment.id || !payment.studentId || !payment.receiptNumber || Number(payment.amount) <= 0)) return false;
      const ids = new Set(candidate.students.map(student => student.id));
      const paymentIds = new Set(candidate.payments.map(payment => payment.id));
      const receipts = new Set(candidate.payments.map(payment => payment.receiptNumber));
      if (ids.size !== candidate.students.length || paymentIds.size !== candidate.payments.length || receipts.size !== candidate.payments.length || !candidate.payments.every(payment => ids.has(payment.studentId))) return false;
      const classes = Array.isArray(candidate.classes) ? candidate.classes : [];
      const attendance = Array.isArray(candidate.attendance) ? candidate.attendance : [];
      const adjustments = Array.isArray(candidate.feeAdjustments) ? candidate.feeAdjustments : [];
      const classIds = new Set(classes.map(item => item.id));
      if (classIds.size !== classes.length || classes.some(item => !item.id || !item.className || !(item.studentIds || []).every(studentId => ids.has(studentId)))) return false;
      const attendanceIds = new Set(attendance.map(record => record.id));
      const attendanceKeys = new Set(attendance.map(record => `${record.studentId}|${record.classId}|${record.attendanceDate}`));
      const adjustmentIds = new Set(adjustments.map(item => item.id));
      const adjustmentsValid = adjustmentIds.size === adjustments.length && adjustments.every(item => item.id && ids.has(item.studentId) && /^\d{4}-\d{2}$/.test(item.monthKey || '') && ['Additional Charge','Discount'].includes(item.adjustmentType) && item.description && Number(item.amount) > 0);
      return adjustmentsValid && attendanceIds.size === attendance.length && attendanceKeys.size === attendance.length && attendance.every(record => record.id && ids.has(record.studentId) && classIds.has(record.classId) && record.attendanceDate && ATTENDANCE_STATUSES.includes(record.status));
    }

    async function importBackup(file) {
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        const imported = parsed.data || parsed;
        if (!validImportedData(imported)) throw new Error('Invalid backup structure');
        if (!confirm('Import this backup? All current data will be replaced.')) return;
        state = { ...emptyData(), ...imported, version: 3, settings:{...DEFAULT_SETTINGS,...(imported.settings || {})}, students: imported.students.map(student => ({...student, form: student.form || ''})), classes: imported.classes || [], attendance: imported.attendance || [], feeAdjustments: imported.feeAdjustments || [], monthlyRecords: imported.monthlyRecords || {}, receiptCounters: imported.receiptCounters || {} };
        normalizeReceiptNumbers(state);
        saveData('Imported backup','Complete JSON Backup'); renderAll(); toast('Backup imported successfully.');
      } catch (error) {
        toast('Invalid file. Please select a valid tuition backup JSON file.', 'error');
      } finally {
        document.getElementById('backupFile').value = '';
      }
    }

    const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    function exportStudentsCsv() {
      const rows = [['Student ID','Student Name','Form','Classes','Parent Name','Parent Phone','Subjects','Monthly Fee (RM)','Join Date','Status','Notes']];
      state.students.forEach(student => rows.push([student.id, student.studentName, student.form, classNamesForStudent(student.id), student.parentName, student.parentPhone, subjectText(student.subjects), studentMonthlyFee(student).toFixed(2), formatDate(student.joinDate), student.status, student.notes]));
      downloadFile(`student-list-${isoToday()}.csv`, '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
      toast('Student list exported successfully.');
    }

    function exportPaymentsCsv() {
      const rows = [['Payment ID','Receipt Number','Student ID','Student Name','Payment Month','Payment Date','Amount (RM)','Payment Method','Status','Notes']];
      state.payments.slice().sort((a,b) => a.paymentDate.localeCompare(b.paymentDate)).forEach(payment => rows.push([payment.id, payment.receiptNumber, payment.studentId, getStudent(payment.studentId)?.studentName || '', monthLabel(paymentMonthKey(payment)), formatDate(payment.paymentDate), Number(payment.amount).toFixed(2), payment.paymentMethod, transactionStatus(payment), payment.notes]));
      downloadFile(`payment-records-${isoToday()}.csv`, '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
      toast('Payment records exported successfully.');
    }

    function clearAllData() {
      if (currentRole !== 'owner') return toast('Only the Owner can clear all workspace data.', 'error');
      const typed = prompt('This permanently deletes all records. Type DELETE ALL DATA to continue:');
      if (typed === null) return;
      if (typed !== 'DELETE ALL DATA') return toast('Confirmation text did not match. No data was deleted.', 'error');
      if (!confirm('Final confirmation: permanently clear all tuition data?')) return;
      state = emptyData(); state.dataVersion = cloudDataVersion; saveData('Cleared all workspace data','Workspace'); renderAll(); toast('All data has been cleared.');
    }

    function loadSampleData() {
      if (state.students.length || state.payments.length || state.classes.length || state.attendance.length) return toast('Sample data can only be loaded into an empty system.', 'error');
      const createdAt = new Date().toISOString();
      const students = [
        { id: uid('stu'), studentName: 'Sample Student A', form:'F5', parentName: 'Sample Parent A', parentPhone: '0100000001', joinDate: '2026-07-01', status: 'Active', subjects: [{name:'Biology',fee:80},{name:'Chemistry',fee:80}], monthlyFee:160, notes:'Fictional sample record', createdAt },
        { id: uid('stu'), studentName: 'Sample Student B', form:'F5', parentName: 'Sample Parent B', parentPhone: '0100000002', joinDate: '2026-07-01', status: 'Active', subjects: [{name:'Biology',fee:80},{name:'Physics',fee:80},{name:'Chemistry',fee:80}], monthlyFee:240, notes:'Fictional sample record', createdAt },
        { id: uid('stu'), studentName: 'Sample Student C', form:'F3', parentName: 'Sample Parent C', parentPhone: '0100000003', joinDate: '2026-07-01', status: 'Active', subjects: [{name:'Science',fee:80}], monthlyFee:80, notes:'Fictional sample record', createdAt }
      ];
      state.students = students;
      ensureMonthlyRecords('2026-07');
      const payments = [
        { id: uid('pay'), receiptNumber: '202607-001', studentId: students[0].id, paymentMonth: 7, paymentYear: 2026, paymentDate: '2026-07-05', amount: 160, paymentMethod: 'Bank Transfer', bankName:'HLB', referenceNumber:'SAMPLE-REFERENCE', transferDate:'2026-07-05', numberOfLessons:4, paymentDescription:'4 Lessons', notes: 'Full payment', createdAt },
        { id: uid('pay'), receiptNumber: '202607-002', studentId: students[1].id, paymentMonth: 7, paymentYear: 2026, paymentDate: '2026-07-06', amount: 100, paymentMethod: 'DuitNow', bankName:'', referenceNumber:'SAMPLE-DUITNOW', transferDate:'2026-07-06', numberOfLessons:4, paymentDescription:'4 Lessons', notes: 'First partial payment', createdAt }
      ];
      state.payments = payments; state.receiptCounters['202607'] = 2;
      payments.forEach(payment => { const row = getMonthRow(payment.studentId,'2026-07'); payment.receiptSnapshot = buildReceiptSnapshot(payment,row); });
      const sampleClass = { id:uid('cls'), className:'F5 Biology Monday', form:'F5', subject:'Biology', day:'Monday', startTime:'16:00', endTime:'17:30', monthlyFee:80, studentIds:[students[0].id,students[1].id], status:'Active', notes:'Sample class', createdAt };
      state.classes = [sampleClass];
      state.attendance = [
        {id:uid('att'),studentId:students[0].id,classId:sampleClass.id,attendanceDate:'2026-07-13',status:'Present',reason:'',notes:'',recordedAt:createdAt},
        {id:uid('att'),studentId:students[1].id,classId:sampleClass.id,attendanceDate:'2026-07-13',status:'Late',reason:'Transport Problem',notes:'Joined class late by 20 minutes',recordedAt:createdAt}
      ];
      saveData('Loaded sample data','Sample records');
      document.getElementById('dashboardMonth').value = '2026-07';
      document.getElementById('monthlyMonth').value = '2026-07';
      renderAll(); toast('Sample data loaded successfully.');
    }

    // ---------- Navigation and event wiring ----------
    function navigate(page) {
      document.querySelectorAll('.page').forEach(section => section.classList.toggle('active', section.id === `page-${page}`));
      document.querySelectorAll('.nav-btn').forEach(button => button.classList.toggle('active', button.dataset.page === page));
      document.getElementById('sidebar').classList.remove('open');
      if (page === 'dashboard') renderDashboard();
      if (page === 'classes') renderClasses();
      if (page === 'timetable') renderTimetable();
      if (page === 'attendance') { renderAttendanceControls(); renderAttendanceHistoryFilters(); renderAttendanceHistory(); }
      if (page === 'monthly') renderMonthly();
      if (page === 'history') { renderHistoryFilters(); renderHistory(); }
      if (page === 'users') renderUsers();
      if (page === 'audit') renderAuditLogs();
      if (page === 'settings') renderSettings();
      window.scrollTo(0, 0);
    }

    document.querySelectorAll('.nav-btn').forEach(button => button.addEventListener('click', () => navigate(button.dataset.page)));
    document.getElementById('menuToggle').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
    document.addEventListener('click', event => {
      const target = event.target.closest('button');
      if (!target) return;
      if (target.dataset.payment) openPaymentForm(target.dataset.payment, target.dataset.month);
      else if (target.dataset.adjustment) openAdjustmentForm(target.dataset.adjustment, target.dataset.month);
      else if (target.dataset.reminder) openReminder(target.dataset.reminder, target.dataset.month);
      else if (target.dataset.editStudent) openStudentForm(target.dataset.editStudent);
      else if (target.dataset.deactivateStudent) deactivateStudent(target.dataset.deactivateStudent);
      else if (target.dataset.deleteStudent) deleteStudent(target.dataset.deleteStudent);
      else if (target.dataset.receipt) showReceipt(target.dataset.receipt);
      else if (target.dataset.reprintReceipt) reprintReceipt(target.dataset.reprintReceipt);
      else if (target.dataset.editPayment) openEditPayment(target.dataset.editPayment);
      else if (target.dataset.deletePayment) deletePayment(target.dataset.deletePayment);
      else if (target.dataset.editAdjustment) editAdjustment(target.dataset.editAdjustment);
      else if (target.dataset.voidAdjustment) voidAdjustment(target.dataset.voidAdjustment);
      else if (target.dataset.studentHistory) showStudentHistory(target.dataset.studentHistory);
      else if (target.dataset.editClass) openClassForm(target.dataset.editClass);
      else if (target.dataset.deleteClass) deleteClass(target.dataset.deleteClass);
      else if (target.dataset.takeAttendance) openAttendanceFor(target.dataset.takeAttendance);
      else if (target.dataset.editAttendance) editAttendanceRecord(target.dataset.editAttendance);
      else if (target.dataset.deleteAttendance) deleteAttendanceRecord(target.dataset.deleteAttendance);
      else if (target.dataset.memberUser) setCoOwnerStatus(target.dataset.memberUser, target.dataset.memberStatus);
      else if (target.dataset.attendanceTab) switchAttendanceTab(target.dataset.attendanceTab);
      else if (target.dataset.formFilter) {
        studentFormFilter = target.dataset.formFilter;
        document.querySelectorAll('[data-form-filter]').forEach(button => button.classList.toggle('active', button.dataset.formFilter === studentFormFilter));
        renderStudents();
      }
    });

    document.querySelectorAll('.modal-close').forEach(button => button.addEventListener('click', () => closeModal(button.closest('.modal-backdrop'))));
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => backdrop.addEventListener('mousedown', event => { if (event.target === backdrop) closeModal(backdrop); }));
    document.addEventListener('keydown', event => { if (event.key === 'Escape') { const open = [...document.querySelectorAll('.modal-backdrop.open')].pop(); if (open) closeModal(open); } });

    document.getElementById('dashboardMonth').addEventListener('change', renderDashboard);
    document.getElementById('monthlyMonth').addEventListener('change', renderMonthly);
    let monthlySummaryResizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(monthlySummaryResizeTimer);
      monthlySummaryResizeTimer = setTimeout(() => {
        if (document.getElementById('page-dashboard').classList.contains('active')) {
          const key = document.getElementById('dashboardMonth').value || currentMonthKey();
          drawMonthlySummaryChart(monthlySummarySeries(key));
        }
      }, 120);
    });
    document.getElementById('studentSearch').addEventListener('input', renderStudents);
    document.getElementById('studentStatusFilter').addEventListener('change', renderStudents);
    document.getElementById('classSearch').addEventListener('input', renderClasses);
    document.getElementById('classStatusFilter').addEventListener('change', renderClasses);
    ['historySearch','historyStudent','historyMonth','historyYear','historyMethod','historyStatus'].forEach(id => document.getElementById(id).addEventListener(id === 'historySearch' ? 'input' : 'change', renderHistory));
    ['attendanceHistoryStudent','attendanceHistoryForm','attendanceHistoryClass','attendanceHistorySubject','attendanceHistoryDate','attendanceHistoryMonth','attendanceHistoryStatus'].forEach(id => document.getElementById(id).addEventListener('change', renderAttendanceHistory));
    document.getElementById('addStudentBtn').addEventListener('click', () => openStudentForm());
    document.getElementById('addClassBtn').addEventListener('click', () => openClassForm());
    document.getElementById('addSubjectRowBtn').addEventListener('click', () => addSubjectRow());
    document.getElementById('studentForm').addEventListener('submit', saveStudent);
    document.getElementById('classForm').addEventListener('submit', saveClass);
    document.getElementById('classFormLevel').addEventListener('change', event => renderClassStudentOptions(event.target.value, []));
    document.getElementById('paymentForm').addEventListener('submit', savePayment);
    document.getElementById('paymentMethod').addEventListener('change', renderPaymentMethodFields);
    document.getElementById('adjustmentForm').addEventListener('submit', saveAdjustment);
    document.getElementById('adjustmentType').addEventListener('change', () => updateAdjustmentDescriptionOptions());
    document.getElementById('adjustmentDescription').addEventListener('change', updateAdjustmentOtherVisibility);
    document.getElementById('cancelAdjustmentEditBtn').addEventListener('click', resetAdjustmentForm);
    document.getElementById('settingsForm').addEventListener('submit', saveSettings);
    document.getElementById('attendanceDate').addEventListener('change', renderAttendanceList);
    document.getElementById('attendanceClass').addEventListener('change', renderAttendanceList);
    document.getElementById('markAllPresentBtn').addEventListener('click', markAllPresent);
    document.getElementById('saveAttendanceBtn').addEventListener('click', saveAttendance);
    document.getElementById('resetAttendanceBtn').addEventListener('click', resetAttendance);
    document.getElementById('printAttendanceBtn').addEventListener('click', printAttendanceList);
    document.getElementById('clearAttendanceFiltersBtn').addEventListener('click', clearAttendanceFilters);
    document.getElementById('exportAttendanceBtn').addEventListener('click', exportAttendanceCsv);
    document.getElementById('exportAttendanceBackupBtn').addEventListener('click', exportAttendanceCsv);
    document.getElementById('todayTimetableBtn').addEventListener('click', () => document.querySelector(`[data-timetable-day="${dayNameForDate(isoToday())}"]`)?.scrollIntoView({behavior:'smooth',block:'center'}));
    document.getElementById('copyReminderBtn').addEventListener('click', copyReminder);
    document.getElementById('openWhatsAppBtn').addEventListener('click', openWhatsApp);
    document.getElementById('printReceiptBtn').addEventListener('click', printReceipt);
    document.getElementById('savePdfBtn').addEventListener('click', printReceipt);
    document.getElementById('loadSampleBtn').addEventListener('click', loadSampleData);
    document.getElementById('exportBackupBtn').addEventListener('click', exportBackup);
    document.getElementById('importBackupBtn').addEventListener('click', () => document.getElementById('backupFile').click());
    document.getElementById('backupFile').addEventListener('change', event => importBackup(event.target.files[0]));
    document.getElementById('exportStudentsBtn').addEventListener('click', exportStudentsCsv);
    document.getElementById('exportPaymentsBtn').addEventListener('click', exportPaymentsCsv);
    document.getElementById('exportPaymentsTopBtn').addEventListener('click', exportPaymentsCsv);
    document.getElementById('clearDataBtn').addEventListener('click', clearAllData);
    document.getElementById('loginForm').addEventListener('submit', submitLogin);
    document.getElementById('forgotPasswordBtn').addEventListener('click', requestPasswordReset);
    document.getElementById('setPasswordForm').addEventListener('submit', submitNewPassword);
    document.getElementById('logoutBtn').addEventListener('click', signOut);
    document.getElementById('inviteForm').addEventListener('submit', inviteCoOwner);
    document.getElementById('refreshAuditBtn').addEventListener('click', renderAuditLogs);

    // Initialize the secure cloud application.
    document.getElementById('dashboardMonth').value = currentMonthKey();
    document.getElementById('monthlyMonth').value = currentMonthKey();
    document.getElementById('attendanceDate').value = isoToday();
    document.getElementById('todayChip').textContent = formatDate(isoToday());
    initializeCloudApp();
