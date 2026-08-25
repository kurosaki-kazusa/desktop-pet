(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const toast = $('#toast');
  let toastTimer = null;

  function showToast(message) {
    $('b', toast).textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1700);
  }

  function showPage(pageName) {
    $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.page === pageName));
    $$('.page').forEach((page) => page.classList.toggle('active', page.id === `page-${pageName}`));
    closeDrawer();
  }

  $$('.nav-item').forEach((button) => button.addEventListener('click', () => showPage(button.dataset.page)));

  $$('.space-item').forEach((button) => {
    button.addEventListener('click', () => {
      $$('.space-item').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      $('#current-space').textContent = button.dataset.space;
      $('#workspace-title').textContent = button.dataset.space;
      showToast(`已切换到「${button.dataset.space}」空间`);
    });
  });

  const cards = $$('.prompt-card');
  let activeFilter = 'all';
  function filterCards() {
    const keyword = $('#prompt-search').value.trim().toLowerCase();
    let visible = 0;
    cards.forEach((card) => {
      const typeMatches = activeFilter === 'all' || card.dataset.type === activeFilter;
      const textMatches = !keyword || card.textContent.toLowerCase().includes(keyword);
      const isVisible = typeMatches && textMatches;
      card.classList.toggle('hidden-card', !isVisible);
      if (isVisible) visible += 1;
    });
    $('#result-count').textContent = visible;
  }

  $$('.filter-chip').forEach((button) => {
    button.addEventListener('click', () => {
      $$('.filter-chip').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      activeFilter = button.dataset.filter;
      filterCards();
    });
  });
  $('#prompt-search').addEventListener('input', filterCards);

  function openDrawer(card) {
    const type = card.dataset.type === 'command' ? '命令' : '提示词';
    const typeElement = $('#drawer-type');
    typeElement.textContent = type;
    typeElement.className = `type ${card.dataset.type}`;
    $('#drawer-title').value = card.dataset.title;
    $('#drawer-space').textContent = $('.card-meta > span:nth-child(2)', card)?.textContent || '常用命令';
    const body = $('pre, .card-body > p', card);
    if (body) $('#drawer-body').value = body.textContent.trim().replace(/……$/, '');
    $('#detail-drawer').classList.add('open');
    $('#drawer-backdrop').classList.add('open');
    $('#detail-drawer').setAttribute('aria-hidden', 'false');
  }

  function closeDrawer() {
    $('#detail-drawer').classList.remove('open');
    $('#drawer-backdrop').classList.remove('open');
    $('#detail-drawer').setAttribute('aria-hidden', 'true');
  }

  cards.forEach((card) => {
    card.addEventListener('click', (event) => {
      if (event.target.closest('.copy-button, .star')) return;
      openDrawer(card);
    });
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') openDrawer(card);
    });
    const body = $('pre, .card-body > p', card);
    body?.addEventListener('dblclick', (event) => {
      event.stopPropagation();
      showToast('已复制全文');
    });
  });

  $('#drawer-close').addEventListener('click', closeDrawer);
  $('#drawer-backdrop').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeDrawer();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      showPage('prompts');
      $('#prompt-search').focus();
    }
  });

  $$('.copy-button').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      showToast(button.textContent.includes('全文') ? '已复制全文' : '已复制到剪贴板');
    });
  });

  $$('.star').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const isActive = button.classList.toggle('active');
      button.textContent = isActive ? '★' : '☆';
      showToast(isActive ? '已加入收藏' : '已取消收藏');
    });
  });

  function showScheduleView(viewName) {
    $$('.schedule-view').forEach((view) => view.classList.toggle('active', view.id === `schedule-${viewName}`));
    $$('.schedule-view-tabs button').forEach((button) => button.classList.toggle('active', button.dataset.scheduleView === viewName));
  }

  $$('[data-schedule-view]').forEach((button) => button.addEventListener('click', () => showScheduleView(button.dataset.scheduleView)));

  let draggedTask = null;
  $$('.task-card').forEach((task) => {
    task.addEventListener('dragstart', () => {
      draggedTask = task;
      requestAnimationFrame(() => task.classList.add('dragging'));
    });
    task.addEventListener('dragend', () => {
      task.classList.remove('dragging');
      $$('.kanban-column').forEach((column) => column.classList.remove('drag-over'));
      draggedTask = null;
    });
  });

  $$('.kanban-column').forEach((column) => {
    column.addEventListener('dragover', (event) => {
      event.preventDefault();
      column.classList.add('drag-over');
    });
    column.addEventListener('dragleave', () => column.classList.remove('drag-over'));
    column.addEventListener('drop', (event) => {
      event.preventDefault();
      column.classList.remove('drag-over');
      if (!draggedTask) return;
      $('.task-list', column).append(draggedTask);
      $$('.kanban-column').forEach((item) => {
        $('header b', item).textContent = $$('.task-card', item).length;
      });
      showToast('任务状态已更新');
    });
  });

  const range = $('.range-control input');
  range?.addEventListener('input', () => $('.range-control b').textContent = `${range.value}%`);

  $$('[data-action="toast"]').forEach((button) => button.addEventListener('click', () => showToast(button.dataset.message)));

  const params = new URLSearchParams(location.search);
  const requestedPage = params.get('page');
  if (['prompts', 'schedule', 'settings'].includes(requestedPage)) showPage(requestedPage);
  const requestedView = params.get('view');
  if (['board', 'calendar', 'reminders'].includes(requestedView)) showScheduleView(requestedView);
  if (params.get('drawer') === '1') openDrawer(cards[0]);
})();
