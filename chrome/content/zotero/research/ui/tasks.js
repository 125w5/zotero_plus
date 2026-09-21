/* SPDX-License-Identifier: AGPL-3.0-or-later */
Object.assign(EasySchUI, {
	async initTasks() {
		await this.E.store.update((s) => {
			if (s.taskMigration === 1) return;
			s.tasks ||= [];
			for (const [project, p] of Object.entries(s.projects))
				for (const t of p.tasks || [])
					if (!s.tasks.some((x) => x.id === t.id))
						s.tasks.push({ ...t, project });
			s.taskMigration = 1;
		});
		const view = this.$('view-schedule');
		view.querySelector('p').textContent =
			'把下一步记在这里。切换论文不会丢失任务；关联论文和截止时间都可修改。';
		this.$('task-title').placeholder = '例如：复现基线实验（Enter 添加）';
		const old = this.$('add-task'),
			add = old.cloneNode(true);
		old.replaceWith(add);
		this.bind('add-task', async () => {
			const task = this.E.core.task(
				this.$('task-title').value,
				this.$('task-date').value,
			);
			task.paperIDs = this.papers.map((p) => p.id);
			await this.E.store.update((s) => s.tasks.push(task));
			this.$('task-title').value = '';
			this.renderTasks();
			this.status('已添加任务，切换文献后仍可在研究日程中查看');
		});
		this.$('task-title').onkeydown = (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				add.click();
			}
		};
		const filter = this.el('select');
		filter.id = 'task-filter';
		filter.setAttribute('aria-label', '任务时间范围');
		for (const [id, label] of [
			['open', '待完成'],
			['today', '今天及逾期'],
			['week', '未来七天'],
			['done', '已完成'],
			['all', '全部任务'],
		]) {
			const o = this.el('option', label);
			o.value = id;
			filter.append(o);
		}
		filter.onchange = () => this.renderTasks();
		view.insertBefore(filter, this.$('tasks'));
		this.renderTasks();
	},
	renderTasks() {
		const target = this.$('tasks');
		if (!target) return;
		target.replaceChildren();
		const filter = this.$('task-filter')?.value || 'open',
			now = new Date(),
			end = new Date(now);
		end.setHours(23, 59, 59, 999);
		const week = new Date(end);
		week.setDate(week.getDate() + 7);
		const all = this.E.store.get().tasks || [];
		const tasks = all
			.filter((t) =>
				filter === 'all' || filter === 'done'
					? filter === 'all' || t.done
					: !t.done &&
						(filter === 'open' ||
							(t.due && new Date(t.due) <= (filter === 'today' ? end : week))),
			)
			.sort(
				(a, b) =>
					Number(a.done) - Number(b.done) ||
					(a.due || '9999').localeCompare(b.due || '9999'),
			);
		const update = async (id, fn) => {
			await this.E.store.update((s) => {
				const t = s.tasks.find((x) => x.id === id);
				if (t) fn(t);
			});
			this.renderTasks();
		};
		for (const task of tasks) {
			const row = this.el('article', undefined, 'task'),
				check = this.el('input');
			check.type = 'checkbox';
			check.checked = task.done;
			check.setAttribute('aria-label', '完成 ' + task.title);
			check.onchange = () =>
				update(task.id, (t) => (t.done = check.checked)).catch((e) =>
					this.status(e.message, true),
				);
			const more = this.el('details');
			more.append(this.el('summary', '修改'));
			const title = this.el('input');
			title.value = task.title;
			title.setAttribute('aria-label', '修改任务名称');
			const due = this.el('input');
			due.type = 'datetime-local';
			due.value =
				task.due?.length === 10 ? task.due + 'T18:00' : task.due || '';
			due.setAttribute('aria-label', '修改截止时间');
			more.append(title, due);
			this.pptButton(
				'保存修改',
				async () => {
					const checked = this.E.core.task(title.value, due.value);
					await update(task.id, (t) => {
						t.title = checked.title;
						t.due = checked.due;
					});
				},
				more,
			);
			this.pptButton(
				'删除任务',
				async () => {
					await this.E.store.update(
						(s) => (s.tasks = s.tasks.filter((t) => t.id !== task.id)),
					);
					this.renderTasks();
					const undo = this.el('button', '撤销删除');
					undo.onclick = async () => {
						await this.E.store.update((s) => {
							if (!s.tasks.some((t) => t.id === task.id)) s.tasks.push(task);
						});
						this.renderTasks();
					};
					target.prepend(undo);
				},
				more,
			);
			row.append(
				check,
				this.el('span', task.title, 'title'),
				this.el('small', task.due?.replace('T', ' ') || '无截止时间'),
				more,
			);
			target.append(row);
			if (task.paperIDs?.length) {
				const links = this.el('details');
				links.append(this.el('summary', `关联 ${task.paperIDs.length} 篇论文`));
				for (const id of task.paperIDs) {
					const item = this.E.getCachedItem(id);
					if (item)
						this.pptButton(
							item.getField('title'),
							() => this.E.openWorkflow('research', { paperID: id }),
							links,
						);
				}
				row.append(links);
			}
		}
		if (!tasks.length)
			target.append(
				this.el(
					'p',
					'这个视图还没有任务。上方输入“读完方法部分”即可开始；也可切换为全部任务。',
					'empty',
				),
			);
	},
});
