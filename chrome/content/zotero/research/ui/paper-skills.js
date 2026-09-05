Object.assign(EasySchUI, {
	initPaperSkills() {
		let select = this.$('paper-skill');
		for (let skill of Object.values(this.E.paperSkills)) {
			let option = this.el('option', skill.title); option.value = skill.id; select.append(option);
		}
		select.value = 'close_read';
		select.addEventListener('change', () => this.loadPaperSkill());
		this.bind('run-paper-skill', () => this.run(select.value));
		this.bind('save-paper-skill', async () => {
			let instruction = this.$('paper-skill-instruction').value.trim();
			if (!instruction || instruction.length > 12000) throw new Error('技能提示词需要 1–12000 个字符');
			await this.E.store.update(state => {
				state.settings.paperSkillOverrides ||= {};
				state.settings.paperSkillOverrides[select.value] = { instruction, version: 'user-' + Date.now() };
			}); this.loadPaperSkill(); this.status('个人技能已保存；证据校验规则继续生效');
		});
		this.bind('reset-paper-skill', async () => {
			await this.E.store.update(state => { delete state.settings.paperSkillOverrides?.[select.value]; });
			this.loadPaperSkill(); this.status('已恢复内置技能版本');
		});
		this.loadPaperSkill();
	},
	loadPaperSkill() {
		let skill = this.E.getPaperSkill(this.$('paper-skill').value, this.E.settings());
		this.$('paper-skill-instruction').value = skill.instruction;
		this.$('paper-skill-version').textContent = `${skill.title} · ${skill.version} · ${skill.customized ? '个人版本' : '内置版本'} · 当前模型 ${this.E.settings().model || '未配置'}`;
	}
});
