export const workerTemplates = [
  {
    id: "prd",
    title: "产品需求文档",
    description: "从一个想法，到可评审的 AI 产品方案",
    icon: "FileText",
    prompt:
      "为一个面向 AI 产品经理的用户访谈分析助手撰写 PRD。用户上传访谈原文后，系统提取痛点、聚类需求并生成有来源依据的洞察。重点说明引用溯源、人工审核、失败回退和验收标准。",
  },
  {
    id: "competitor",
    title: "竞品研究",
    description: "对齐比较维度，找出真正的产品机会",
    icon: "ScanSearch",
    prompt:
      "根据我提供的资料分析 AI 办公助手的竞品格局。比较目标用户、核心工作流、交付物、可信度设计与商业模式。严格区分资料事实、分析推断和待验证问题；没有资料时先给研究计划。",
  },
  {
    id: "interview",
    title: "用户访谈洞察",
    description: "让每个洞察，都能回到用户的原话",
    icon: "MessagesSquare",
    prompt:
      "整理上传的用户访谈资料：提炼用户目标、当前替代方案、使用障碍和需求优先级。保留原话与来源，区分用户明确诉求和我们的推断，给出后续访谈问题。",
  },
  {
    id: "evaluation",
    title: "AI 评测方案",
    description: "定义指标、测试用例与 Bad Case 归因",
    icon: "FlaskConical",
    prompt:
      "为一个 RAG 知识库问答产品制定评测方案，包含事实准确性、引用有效性、拒答质量、任务完成率、延迟与成本。给出评分细则、至少 8 条具体测试用例、Bad Case 分类和上线门槛；不要编造评测结果。",
  },
  {
    id: "weekly",
    title: "产品周报",
    description: "整理进展、风险与下周的关键决策",
    icon: "CalendarDays",
    prompt:
      "将我提供的工作记录整理成 AI 产品经理周报，包含本周交付、用户反馈、验证结果、未解决风险和下周计划。未提供的数据标为待补充，不将计划写成已完成。",
  },
  {
    id: "brief",
    title: "会议决策记录",
    description: "从讨论中提取决策、负责人和下一步",
    icon: "ListChecks",
    prompt:
      "整理会议材料，输出会议目标、主要讨论、已确认决策、分歧和行动项。每个行动项写明负责人和优先级，未明确的信息标记待确认。",
  },
];
export const factoryTemplates = [
  {
    id: "roadmap",
    title: "产品路线图",
    description: "把想法排成清晰、可推进的路线图",
    tag: "项目协作",
    prompt:
      "制作一个 AI 产品路线图看板，包含待探索、验证中、开发中、已交付四列。支持添加需求、编辑、删除、优先级、关键词搜索和状态流转；有按状态统计和 JSON 数据导出。",
  },
  {
    id: "evaluation",
    title: "模型评测台",
    description: "管理测试集，记录评分与 Bad Case",
    tag: "AI 产品",
    prompt:
      "制作 AI 模型人工评测工作台。支持新增测试用例、填写模型名称、原始回答、准确性和完整性评分、Bad Case 标签。支持编辑、删除、搜索和筛选，计算已评测用例均分，导出 CSV。明确这是人工记录台，不实际调用模型。",
  },
  {
    id: "feedback",
    title: "用户反馈池",
    description: "收集反馈，把高频痛点变成需求",
    tag: "用户研究",
    prompt:
      "制作用户反馈管理工具。支持录入反馈、用户类型、来源渠道、影响程度、处理状态；支持编辑删除、关键字搜索、按状态筛选和数据导出。包含统计摘要和空状态。",
  },
  {
    id: "experiment",
    title: "产品实验室",
    description: "记录假设、实验过程与证据",
    tag: "增长验证",
    prompt:
      "制作 AI 产品实验追踪器。每个实验包含假设、目标指标、样本量、负责人、结果和状态。支持新增编辑删除、状态筛选、证据备注以及导出。展示示例实验但不要把示例数据当成真实验证。",
  },
];
export function demoWorker(job, documents) {
  const sources = documents.length
    ? documents
        .map((d, i) => `- [来源 ${i + 1}] ${d.name}（${d.text.length} 字符）`)
        .join("\n")
    : "未提供资料，以下内容仅为演示结构。";
  return {
    title: job.title,
    summary:
      "演示产物：展示文档结构和行动项流程，未调用 AI。切换 Codex 或 API 后可按实际需求生成。",
    markdown: `# ${job.title}\n\n> 演示模式 · 固定结构示例，未调用 AI，未对材料作真实分析。\n\n## 任务原文\n\n${job.prompt}\n\n## 材料清单\n\n${sources}\n\n## 1. 问题定义\n\nAI 产品经理需要把分散的输入转换成可评审、可验证的交付物。当前需求中的具体用户、使用频率和影响程度仍需依据实际材料确认。\n\n## 2. 交付框架\n\n| 模块 | 需要回答的问题 | 验收方式 |\n|---|---|---|\n| 用户与场景 | 谁在什么条件下使用？ | 与访谈材料逐条对照 |\n| 核心工作流 | 输入、处理、产出各是什么？ | 完成一次端到端试用 |\n| AI 能力边界 | 什么能自动完成，什么需要复核？ | 覆盖失败与拒答测试 |\n| 效果评估 | 质量、效率、成本如何定义？ | 用真实样本计算基线 |\n\n## 3. 待验证假设\n\n- 用户是否愿意把现有材料导入工具，而不是继续手工整理？\n- 结构化交付物能否减少评审返工？\n- 引用溯源是否有助于核对 AI 输出？\n\n以上均为假设，没有用户研究或实验结果支持。\n\n## 4. AI 行为与异常处理\n\n材料不足时明确标注信息缺口；输出中的推断须与来源事实分开。接口失败时保留任务输入，允许重试；禁止将生成失败显示为已完成。\n\n## 5. 下一步\n\n补齐资料，明确交付对象与验收标准，然后使用真实模型重新运行此任务。`,
    actions: [
      { title: "补充原始资料与问题背景", owner: "待指派", priority: "high" },
      {
        title: "明确交付物的评审人与验收标准",
        owner: "产品经理",
        priority: "medium",
      },
    ],
  };
}
export function starterApp(title, kind = "roadmap") {
  const label =
    kind === "evaluation"
      ? "评测用例"
      : kind === "feedback"
        ? "用户反馈"
        : kind === "experiment"
          ? "产品实验"
          : "产品需求";
  const config = JSON.stringify({ title, label }).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>工作台</title><style>
*{box-sizing:border-box}body{margin:0;background:#f6f7fb;color:#242a38;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,select,textarea{font:inherit}button{cursor:pointer;border:1px solid #dce0e8;background:white;border-radius:8px;padding:9px 13px;color:#383e4e}button:hover{border-color:#6475d0}header{padding:24px 5%;background:#fff;border-bottom:1px solid #e5e7ef;display:flex;justify-content:space-between;align-items:center}h1{font-size:23px;margin:5px 0}.eyebrow{font-size:11px;letter-spacing:2px;color:#6b77b5}main{max-width:1200px;margin:30px auto;padding:0 24px}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.stat{background:white;border:1px solid #e5e7ee;border-radius:12px;padding:19px}.stat strong{display:block;font-size:27px;margin-top:8px}.tools{display:flex;gap:10px;margin:24px 0;flex-wrap:wrap}input,select,textarea{border:1px solid #dce0e8;background:white;border-radius:8px;padding:11px;color:#262e3c}#search{flex:1;min-width:160px}.primary{background:#5265c5;color:white;border-color:#5265c5}.board{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.column{background:#eceef5;border-radius:12px;padding:13px;min-height:250px}.column h2{font-size:13px;margin:5px 0 18px;display:flex;justify-content:space-between}.card{padding:16px;margin-bottom:12px;background:#fff;border:1px solid #e0e4ec;border-radius:10px;box-shadow:0 3px 6px #22222203}.card h3{font-size:14px;margin:12px 0;overflow-wrap:anywhere}.card p{color:#7c8594;font-size:12px;line-height:1.6;white-space:pre-wrap}.card select{width:100%;font-size:12px;padding:7px;margin:10px 0}.badge{font-size:10px;background:#eef0fc;color:#6370b0;padding:4px 7px;border-radius:4px}.row{display:flex;gap:5px;justify-content:space-between;align-items:center}.small{font-size:11px;padding:4px 6px;border:none;color:#788193}.empty{color:#8992a1;font-size:12px;text-align:center;padding:30px 0}dialog{border:1px solid #dce0e8;border-radius:16px;width:min(450px,90vw);padding:26px;box-shadow:0 20px 80px #242a3840}dialog::backdrop{background:#20283850}form label{display:block;margin:15px 0 6px}form input,form select,form textarea{width:100%}form textarea{height:90px}form footer{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}.note{color:#88909d;font-size:12px;margin-top:24px}@media(max-width:750px){.board{grid-template-columns:1fr 1fr}.stats{gap:8px}header{gap:12px}}@media(max-width:450px){.board{grid-template-columns:1fr}header{align-items:flex-start}.stat{padding:12px}}
</style></head><body><header><div><div class="eyebrow">PRODUCT WORKSPACE</div><h1 id="title"></h1></div><button id="export">导出 JSON</button></header><main><div class="stats"><div class="stat">全部记录<strong id="total">0</strong></div><div class="stat">进行中<strong id="active">0</strong></div><div class="stat">已交付<strong id="done">0</strong></div></div><div class="tools"><input id="search" aria-label="搜索记录" placeholder="搜索标题或备注…"><select id="filter" aria-label="优先级筛选"><option value="">全部优先级</option><option>高</option><option>中</option><option>低</option></select><button class="primary" id="add">＋ 新建记录</button></div><div class="board" id="board"></div><p class="note">初始内容为示例数据。导出后运行可在本地浏览器保存；工厂沙盒预览中刷新会恢复数据。此模板未连接后端或 AI 服务。</p></main><dialog id="dialog"><form id="form"><h2 id="formTitle">新建记录</h2><label for="name">标题</label><input id="name" required maxlength="120"><label for="priority">优先级</label><select id="priority"><option>中</option><option>高</option><option>低</option></select><label for="notes">备注 / 验收标准</label><textarea id="notes" maxlength="3000"></textarea><footer><button type="button" id="cancel">取消</button><button class="primary" type="submit">保存</button></footer></form></dialog><script>
const config=${config};document.title=config.title;document.getElementById('title').textContent=config.title;
const states=['待探索','验证中','开发中','已交付'];const storageKey='pm-app-'+config.title;let rows=[{id:'1',title:'示例：明确目标用户与问题',priority:'高',notes:'访谈 5 位目标用户，记录他们的现有工作方式。',status:'待探索'},{id:'2',title:'示例：验证核心交互',priority:'中',notes:'观察用户是否能够独立完成主要流程。',status:'验证中'},{id:'3',title:'示例：整理首轮反馈',priority:'中',notes:'将事实、推断与待验证问题分开记录。',status:'开发中'}];try{const saved=JSON.parse(localStorage.getItem(storageKey));if(Array.isArray(saved))rows=saved}catch{}let editing=null;const el=id=>document.getElementById(id);function save(){try{localStorage.setItem(storageKey,JSON.stringify(rows))}catch{}render()}function render(){el('total').textContent=rows.length;el('active').textContent=rows.filter(r=>['验证中','开发中'].includes(r.status)).length;el('done').textContent=rows.filter(r=>r.status==='已交付').length;el('board').replaceChildren();for(const status of states){const column=document.createElement('section');column.className='column';const selected=rows.filter(r=>r.status===status&&(!el('filter').value||r.priority===el('filter').value)&&(r.title+' '+r.notes).toLowerCase().includes(el('search').value.toLowerCase()));const heading=document.createElement('h2');heading.textContent=status+' · '+selected.length;column.append(heading);if(!selected.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='暂无记录';column.append(empty)}for(const row of selected){const card=document.createElement('article');card.className='card';const badge=document.createElement('span');badge.className='badge';badge.textContent=row.priority+'优先级';const title=document.createElement('h3');title.textContent=row.title;const notes=document.createElement('p');notes.textContent=row.notes;const select=document.createElement('select');select.setAttribute('aria-label','修改 '+row.title+' 的状态');for(const state of states){const option=document.createElement('option');option.textContent=state;select.append(option)}select.value=row.status;select.onchange=()=>{row.status=select.value;save()};const actions=document.createElement('div');actions.className='row';const edit=document.createElement('button');edit.className='small';edit.textContent='编辑';edit.onclick=()=>open(row);const del=document.createElement('button');del.className='small';del.textContent='删除';del.onclick=()=>{rows=rows.filter(r=>r.id!==row.id);save()};actions.append(edit,del);card.append(badge,title,notes,select,actions);column.append(card)}el('board').append(column)}}function open(row){editing=row?.id||null;el('formTitle').textContent=editing?'编辑记录':'新建'+config.label;el('name').value=row?.title||'';el('notes').value=row?.notes||'';el('priority').value=row?.priority||'中';el('dialog').showModal()}el('add').onclick=()=>open();el('cancel').onclick=()=>el('dialog').close();el('form').onsubmit=e=>{e.preventDefault();const title=el('name').value.trim();if(!title)return;const data={title,notes:el('notes').value.trim(),priority:el('priority').value};if(editing)Object.assign(rows.find(r=>r.id===editing),data);else rows.push({id:crypto.randomUUID(),status:states[0],...data});save();el('dialog').close()};el('search').oninput=render;el('filter').onchange=render;el('export').onclick=()=>{const a=document.createElement('a');const url=URL.createObjectURL(new Blob([JSON.stringify(rows,null,2)],{type:'application/json'}));a.href=url;a.download='records.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),500)};render();
</script></body></html>`;
}
export function demoFactory(job) {
  return {
    title: job.title,
    description: "演示：可交互的产品需求看板模板，未调用 AI。",
    commentary:
      "使用内置看板模板。自由需求与模板内容可能不一致，请切换真实模型生成。",
    code: starterApp(job.title, job.kind),
    prd: `# ${job.title}\n\n> 演示模板，未按自由需求调用 AI。\n\n## 用户需求\n\n${job.prompt}\n\n## 当前已实现\n\n- 记录新增、编辑、删除\n- 四列状态流转\n- 标题与备注搜索、优先级筛选\n- 统计总量、进行中和已交付数量\n- JSON 数据导出\n\n## 数据模型\n\n记录包含 id、title、notes、priority、status。\n\n## 验收\n\n新建记录后在待探索列出现；修改状态后移动到目标列；筛选后只显示匹配数据；删除后统计同步更新。\n\n## 限制\n\n这是浏览器原型，没有用户鉴权、多人协作或数据库后端。工厂预览不持久化应用内记录；导出运行后使用浏览器 localStorage。接入真实 AI、后端和权限需要继续开发。`,
  };
}
