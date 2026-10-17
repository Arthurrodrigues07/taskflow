
"use strict";

const STORAGE_KEY="taskflow_v1";
const MAX_BACKUP_SIZE=2*1024*1024;
const STATUSES=["todo","progress","done"];
const PRIORITIES=["low","medium","high"];
const STATUS_LABELS={todo:"A fazer",progress:"Em andamento",done:"Concluído"};
const PRIORITY_LABELS={low:"Baixa",medium:"Média",high:"Alta"};
const $=id=>document.getElementById(id);

let data=loadData();
let currentPage="dashboard";
let currentProjectId=null;
let currentView="kanban";
let confirmCallback=null;
let draggedTaskId=null;
let previousFocus=null;

function createId(){
return crypto.randomUUID?crypto.randomUUID():"id-"+Date.now()+"-"+Math.random().toString(36).slice(2);
}

function emptyData(){
return {version:1,projects:[],tasks:[]};
}

function isObject(value){
return value!==null&&typeof value==="object"&&!Array.isArray(value);
}

function validDate(value){
if(value==="")return true;
if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
const date=new Date(value+"T12:00:00");
return !Number.isNaN(date.getTime())&&date.getFullYear()===Number(value.slice(0,4))&&date.getMonth()+1===Number(value.slice(5,7))&&date.getDate()===Number(value.slice(8,10));
}

function validateData(value){
if(!isObject(value)||value.version!==1||!Array.isArray(value.projects)||!Array.isArray(value.tasks))throw Error("Formato de backup inválido.");
if(value.projects.length>1000||value.tasks.length>20000)throw Error("O backup excede os limites permitidos.");
const projectIds=new Set();
const taskIds=new Set();
const projects=value.projects.map(project=>{
if(!isObject(project)||typeof project.id!=="string"||project.id.length>100||!project.id||typeof project.name!=="string"||!project.name.trim()||project.name.length>80||typeof project.description!=="string"||project.description.length>500||typeof project.createdAt!=="string"||!Number.isFinite(Date.parse(project.createdAt)))throw Error("O backup contém um projeto inválido.");
if(projectIds.has(project.id))throw Error("O backup contém IDs de projetos duplicados.");
projectIds.add(project.id);
return {id:project.id,name:project.name,description:project.description,createdAt:project.createdAt};
});
const tasks=value.tasks.map(task=>{
if(!isObject(task)||typeof task.id!=="string"||!task.id||task.id.length>100||typeof task.projectId!=="string"||!projectIds.has(task.projectId)||typeof task.title!=="string"||!task.title.trim()||task.title.length>120||typeof task.description!=="string"||task.description.length>1000||!PRIORITIES.includes(task.priority)||!STATUSES.includes(task.status)||!validDate(task.dueDate)||typeof task.createdAt!=="string"||!Number.isFinite(Date.parse(task.createdAt)))throw Error("O backup contém uma tarefa inválida.");
if(taskIds.has(task.id))throw Error("O backup contém IDs de tarefas duplicados.");
taskIds.add(task.id);
return {id:task.id,projectId:task.projectId,title:task.title,description:task.description,priority:task.priority,status:task.status,dueDate:task.dueDate,createdAt:task.createdAt};
});
return {version:1,projects,tasks};
}

function loadData(){
try{
const stored=localStorage.getItem(STORAGE_KEY);
return stored?validateData(JSON.parse(stored)):emptyData();
}catch(error){
console.error("Falha ao carregar dados:",error);
return emptyData();
}
}

function saveData(){
try{
localStorage.setItem(STORAGE_KEY,JSON.stringify(data));
return true;
}catch(error){
console.error("Falha ao salvar dados:",error);
toast("Não foi possível salvar. Verifique o armazenamento do navegador.",true);
return false;
}
}

function updateData(nextData,message){
const previous=data;
data=nextData;
if(!saveData()){
data=previous;
return false;
}
renderAll();
if(message)toast(message);
return true;
}

function element(tag,className,text){
const node=document.createElement(tag);
if(className)node.className=className;
if(text!==undefined)node.textContent=String(text);
return node;
}

function append(parent,...children){
children.forEach(child=>parent.appendChild(child));
return parent;
}

function formatDate(value){
if(!value)return "Sem prazo";
const [year,month,day]=value.split("-");
return `${day}/${month}/${year}`;
}

function todayString(){
const date=new Date();
const year=date.getFullYear();
const month=String(date.getMonth()+1).padStart(2,"0");
const day=String(date.getDate()).padStart(2,"0");
return `${year}-${month}-${day}`;
}

function isOverdue(task){
return Boolean(task.dueDate&&task.dueDate<todayString()&&task.status!=="done");
}

function projectTasks(id){
return data.tasks.filter(task=>task.projectId===id);
}

function percentage(tasks){
return tasks.length?Math.round(tasks.filter(task=>task.status==="done").length/tasks.length*100):0;
}

function getProject(id){
return data.projects.find(project=>project.id===id);
}

function getTask(id){
return data.tasks.find(task=>task.id===id);
}

function sortedTasks(tasks,sort){
const copy=[...tasks];
if(sort==="due")return copy.sort((a,b)=>(a.dueDate||"9999-12-31").localeCompare(b.dueDate||"9999-12-31")||b.createdAt.localeCompare(a.createdAt));
if(sort==="priority")return copy.sort((a,b)=>PRIORITIES.indexOf(b.priority)-PRIORITIES.indexOf(a.priority)||b.createdAt.localeCompare(a.createdAt));
return copy.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}

function showPage(page){
const allowed=["dashboard","projects","tasks","settings","project-detail"];
if(!allowed.includes(page))return;
if(page==="project-detail"&&!getProject(currentProjectId))page="projects";
currentPage=page;
document.querySelectorAll(".page").forEach(section=>section.classList.toggle("active",section.id==="page-"+page));
document.querySelectorAll(".nav-item").forEach(button=>button.classList.toggle("active",button.dataset.page===page||(page==="project-detail"&&button.dataset.page==="projects")));
const labels={dashboard:"Visão geral",projects:"Meus projetos",tasks:"Todas as tarefas",settings:"Configurações","project-detail":"Detalhes do projeto"};
$("breadcrumbTitle").textContent=labels[page];
closeSidebar();
renderAll();
window.scrollTo({top:0,behavior:"smooth"});
}

function openProject(id){
if(!getProject(id))return;
currentProjectId=id;
currentView="kanban";
$("detailTaskSearch").value="";
$("detailPriorityFilter").value="all";
$("detailSort").value="recent";
showPage("project-detail");
}

function openSidebar(){
$("sidebar").classList.add("open");
$("sidebarOverlay").classList.add("active");
}

function closeSidebar(){
$("sidebar").classList.remove("open");
$("sidebarOverlay").classList.remove("active");
}

function openModal(id){
const modal=$(id);
if(!modal)return;
previousFocus=document.activeElement;
modal.classList.remove("hidden");
document.body.classList.add("modal-open");
const target=modal.querySelector("input:not([type=hidden]),select,button");
if(target)target.focus();
}

function closeModal(id){
$(id).classList.add("hidden");
if(!document.querySelector(".modal-backdrop:not(.hidden)"))document.body.classList.remove("modal-open");
if(id==="confirmModal")confirmCallback=null;
if(previousFocus&&previousFocus.isConnected)previousFocus.focus();
}

function toast(message,error=false){
const node=element("div","toast"+(error?" error":""),message);
$("toastContainer").appendChild(node);
setTimeout(()=>node.remove(),4000);
}

function confirmAction(title,message,callback,buttonText="Confirmar"){
$("confirmModalTitle").textContent=title;
$("confirmMessage").textContent=message;
$("confirmAction").textContent=buttonText;
confirmCallback=callback;
openModal("confirmModal");
}

function openProjectModal(id=null){
$("projectForm").reset();
$("projectId").value="";
$("projectModalTitle").textContent=id?"Editar projeto":"Novo projeto";
if(id){
const project=getProject(id);
if(!project)return;
$("projectId").value=project.id;
$("projectName").value=project.name;
$("projectDescription").value=project.description;
}
openModal("projectModal");
}

function saveProject(event){
event.preventDefault();
const id=$("projectId").value;
const name=$("projectName").value.trim();
const description=$("projectDescription").value.trim();
if(!name){toast("Informe o nome do projeto.",true);return;}
const next=structuredClone(data);
if(id){
const project=next.projects.find(item=>item.id===id);
if(!project)return;
project.name=name;
project.description=description;
}else{
next.projects.push({id:createId(),name,description,createdAt:new Date().toISOString()});
}
if(updateData(next,id?"Projeto atualizado.":"Projeto criado."))closeModal("projectModal");
}

function deleteProject(id){
const project=getProject(id);
if(!project)return;
confirmAction("Excluir projeto",`Deseja excluir "${project.name}" e todas as tarefas vinculadas? Esta ação não pode ser desfeita.`,()=>{
const next=structuredClone(data);
next.projects=next.projects.filter(item=>item.id!==id);
next.tasks=next.tasks.filter(item=>item.projectId!==id);
if(updateData(next,"Projeto excluído.")){
closeModal("confirmModal");
if(currentProjectId===id){currentProjectId=null;showPage("projects");}
}
},"Excluir projeto");
}

function openTaskModal(id=null){
if(!data.projects.length){
toast("Crie um projeto antes de adicionar tarefas.",true);
showPage("projects");
return;
}
$("taskForm").reset();
$("taskId").value="";
$("taskModalTitle").textContent=id?"Editar tarefa":"Nova tarefa";
const select=$("taskProject");
select.replaceChildren();
append(select,element("option","","Selecione um projeto"));
select.firstChild.value="";
data.projects.forEach(project=>{
const option=element("option","",project.name);
option.value=project.id;
select.appendChild(option);
});
$("taskPriority").value="medium";
$("taskStatus").value="todo";
if(id){
const task=getTask(id);
if(!task)return;
$("taskId").value=task.id;
$("taskTitle").value=task.title;
$("taskProject").value=task.projectId;
$("taskDescription").value=task.description;
$("taskPriority").value=task.priority;
$("taskStatus").value=task.status;
$("taskDueDate").value=task.dueDate;
}else if(currentPage==="project-detail"&&getProject(currentProjectId)){
select.value=currentProjectId;
}else if(data.projects.length===1){
select.value=data.projects[0].id;
}
openModal("taskModal");
}

function saveTask(event){
event.preventDefault();
const id=$("taskId").value;
const title=$("taskTitle").value.trim();
const projectId=$("taskProject").value;
const description=$("taskDescription").value.trim();
const priority=$("taskPriority").value;
const status=$("taskStatus").value;
const dueDate=$("taskDueDate").value;
if(!title||!getProject(projectId)||!PRIORITIES.includes(priority)||!STATUSES.includes(status)||!validDate(dueDate)){
toast("Confira os dados da tarefa.",true);
return;
}
const next=structuredClone(data);
if(id){
const task=next.tasks.find(item=>item.id===id);
if(!task)return;
Object.assign(task,{title,projectId,description,priority,status,dueDate});
}else{
next.tasks.push({id:createId(),projectId,title,description,priority,status,dueDate,createdAt:new Date().toISOString()});
}
if(updateData(next,id?"Tarefa atualizada.":"Tarefa criada."))closeModal("taskModal");
}

function deleteTask(id){
const task=getTask(id);
if(!task)return;
confirmAction("Excluir tarefa",`Deseja excluir a tarefa "${task.title}"? Esta ação não pode ser desfeita.`,()=>{
const next=structuredClone(data);
next.tasks=next.tasks.filter(item=>item.id!==id);
if(updateData(next,"Tarefa excluída."))closeModal("confirmModal");
},"Excluir tarefa");
}

function changeTaskStatus(id,status){
if(!STATUSES.includes(status))return;
const next=structuredClone(data);
const task=next.tasks.find(item=>item.id===id);
if(!task||task.status===status)return;
task.status=status;
updateData(next,"Status atualizado.");
}

function makeActionButton(label,symbol,callback,danger=false){
const button=element("button","action-btn"+(danger?" danger":""),symbol);
button.type="button";
button.title=label;
button.setAttribute("aria-label",label);
button.addEventListener("click",callback);
return button;
}

function makeBadge(type,value){
return element("span",type+"-badge "+type+"-"+value,(type==="priority"?PRIORITY_LABELS:STATUS_LABELS)[value]);
}

function makeEmpty(title,description,buttonLabel,callback){
const wrapper=element("div","empty-state");
append(wrapper,element("div","empty-state-icon","▤"),element("h3","",title),element("p","",description));
if(buttonLabel){
const button=element("button","btn btn-primary",buttonLabel);
button.type="button";
button.addEventListener("click",callback);
wrapper.appendChild(button);
}
return wrapper;
}

function makeProjectCard(project){
const tasks=projectTasks(project.id);
const percent=percentage(tasks);
const card=element("article","project-card");
const top=element("div","project-card-top");
const actions=element("div","project-actions");
append(actions,makeActionButton("Editar projeto","✎",()=>openProjectModal(project.id)),makeActionButton("Excluir projeto","×",()=>deleteProject(project.id),true));
append(top,element("span","project-folder","▤"),actions);
const meta=element("div","project-meta");
append(meta,element("span","",tasks.length+" tarefa"+(tasks.length===1?"":"s")),element("strong","",percent+"%"));
const track=element("div","progress-track");
const fill=element("div","progress-fill");
fill.style.width=percent+"%";
track.appendChild(fill);
const open=element("button","project-open","Abrir projeto →");
open.type="button";
open.addEventListener("click",()=>openProject(project.id));
append(card,top,element("h3","",project.name),element("p","",project.description||"Projeto sem descrição."),meta,track,open);
return card;
}

function renderDashboard(){
const projects=data.projects;
const tasks=data.tasks;
$("statProjects").textContent=projects.length;
$("statTasks").textContent=tasks.length;
$("statProgress").textContent=tasks.filter(task=>task.status==="progress").length;
$("statCompleted").textContent=tasks.filter(task=>task.status==="done").length;
const percent=percentage(tasks);
$("overallPercentage").textContent=percent+"%";
$("overallProgress").style.width=percent+"%";
STATUSES.forEach((status,index)=>{
$(["countTodo","countProgress","countDone"][index]).textContent=tasks.filter(task=>task.status===status).length;
});
const upcoming=$("upcomingTasks");
upcoming.replaceChildren();
const due=tasks.filter(task=>task.dueDate&&task.status!=="done").sort((a,b)=>a.dueDate.localeCompare(b.dueDate)).slice(0,4);
if(!due.length)upcoming.appendChild(element("p","empty-inline","Nenhuma tarefa com prazo definido."));
due.forEach(task=>{
const row=element("div","upcoming-item");
const info=element("div");
append(info,element("strong","",task.title),element("small","",getProject(task.projectId)?.name||"Projeto"));
append(row,info,element("span","upcoming-date"+(isOverdue(task)?" overdue":""),formatDate(task.dueDate)));
upcoming.appendChild(row);
});
const container=$("dashboardProjects");
container.replaceChildren();
const recent=[...projects].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,3);
if(!recent.length)container.appendChild(makeEmpty("Nenhum projeto ainda","Crie seu primeiro projeto para começar a organizar suas tarefas.","Criar projeto",()=>openProjectModal()));
else recent.forEach(project=>container.appendChild(makeProjectCard(project)));
}

function renderProjects(){
const term=$("projectSearch").value.trim().toLocaleLowerCase("pt-BR");
const projects=[...data.projects].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).filter(project=>(project.name+" "+project.description).toLocaleLowerCase("pt-BR").includes(term));
$("projectsCount").textContent=projects.length+" projeto"+(projects.length===1?"":"s");
const container=$("projectsGrid");
container.replaceChildren();
if(!projects.length){
container.appendChild(makeEmpty(term?"Nenhum resultado":"Nenhum projeto criado",term?"Tente pesquisar por outro termo.":"Comece criando seu primeiro projeto.",term?"":"Criar projeto",()=>openProjectModal()));
return;
}
projects.forEach(project=>container.appendChild(makeProjectCard(project)));
}

function makeTaskRow(task,showProject){
const row=element("tr");
const title=element("td","task-title-cell",task.title);
if(task.description)title.appendChild(element("small","task-subtitle",task.description.length>75?task.description.slice(0,75)+"...":task.description));
row.appendChild(title);
if(showProject)row.appendChild(element("td","",getProject(task.projectId)?.name||"Projeto removido"));
const priority=element("td");
priority.appendChild(makeBadge("priority",task.priority));
row.appendChild(priority);
row.appendChild(element("td","",formatDate(task.dueDate)));
const status=element("td");
status.appendChild(makeBadge("status",task.status));
row.appendChild(status);
const actions=element("td");
const group=element("div","table-actions");
append(group,makeActionButton("Editar tarefa","✎",()=>openTaskModal(task.id)),makeActionButton("Excluir tarefa","×",()=>deleteTask(task.id),true));
actions.appendChild(group);
row.appendChild(actions);
return row;
}

function renderGlobalTasks(){
const term=$("globalTaskSearch").value.trim().toLocaleLowerCase("pt-BR");
const status=$("globalStatusFilter").value;
const priority=$("globalPriorityFilter").value;
const sort=$("globalSort").value;
const filtered=sortedTasks(data.tasks.filter(task=>{
const project=getProject(task.projectId);
return (task.title+" "+task.description+" "+(project?.name||"")).toLocaleLowerCase("pt-BR").includes(term)&&(status==="all"||task.status===status)&&(priority==="all"||task.priority===priority);
}),sort);
const body=$("globalTasksBody");
body.replaceChildren();
if(!filtered.length){
const row=element("tr");
const cell=element("td","empty-inline","Nenhuma tarefa encontrada.");
cell.colSpan=6;
row.appendChild(cell);
body.appendChild(row);
return;
}
filtered.forEach(task=>body.appendChild(makeTaskRow(task,true)));
}

function makeKanbanCard(task){
const card=element("article","kanban-card");
card.draggable=true;
card.dataset.taskId=task.id;
card.addEventListener("dragstart",event=>{
draggedTaskId=task.id;
card.classList.add("dragging");
event.dataTransfer.effectAllowed="move";
event.dataTransfer.setData("text/plain",task.id);
});
card.addEventListener("dragend",()=>{
draggedTaskId=null;
card.classList.remove("dragging");
document.querySelectorAll(".kanban-column").forEach(column=>column.classList.remove("drag-over"));
});
const top=element("div","kanban-card-top");
const actions=element("div","kanban-card-actions");
append(actions,makeActionButton("Editar tarefa","✎",()=>openTaskModal(task.id)),makeActionButton("Excluir tarefa","×",()=>deleteTask(task.id),true));
append(top,makeBadge("priority",task.priority),actions);
card.appendChild(top);
card.appendChild(element("h4","",task.title));
if(task.description)card.appendChild(element("p","",task.description));
const footer=element("div","kanban-card-footer");
footer.appendChild(element("span",isOverdue(task)?"overdue":"",task.dueDate?formatDate(task.dueDate):"Sem prazo"));
const statusSelect=element("select");
statusSelect.setAttribute("aria-label","Alterar status da tarefa "+task.title);
statusSelect.style.cssText="max-width:130px;border:1px solid #e6eaf0;border-radius:6px;background:#fff;padding:5px;font-size:10px;color:#475569";
STATUSES.forEach(status=>{
const option=element("option","",STATUS_LABELS[status]);
option.value=status;
statusSelect.appendChild(option);
});
statusSelect.value=task.status;
statusSelect.addEventListener("change",event=>changeTaskStatus(task.id,event.target.value));
statusSelect.addEventListener("mousedown",event=>event.stopPropagation());
footer.appendChild(statusSelect);
card.appendChild(footer);
return card;
}

function renderProjectDetail(){
const project=getProject(currentProjectId);
if(!project)return;
$("detailProjectName").textContent=project.name;
$("detailProjectDescription").textContent=project.description||"Projeto sem descrição.";
const all=projectTasks(project.id);
const percent=percentage(all);
$("detailProjectPercentage").textContent=percent+"%";
$("detailProjectProgress").style.width=percent+"%";
$("detailTaskSummary").textContent=all.filter(task=>task.status==="done").length+" de "+all.length+" tarefas concluídas";
const term=$("detailTaskSearch").value.trim().toLocaleLowerCase("pt-BR");
const priority=$("detailPriorityFilter").value;
const sort=$("detailSort").value;
const filtered=sortedTasks(all.filter(task=>(task.title+" "+task.description).toLocaleLowerCase("pt-BR").includes(term)&&(priority==="all"||task.priority===priority)),sort);
$("kanbanViewBtn").classList.toggle("active",currentView==="kanban");
$("listViewBtn").classList.toggle("active",currentView==="list");
$("kanbanBoard").classList.toggle("hidden",currentView!=="kanban");
$("projectListView").classList.toggle("hidden",currentView!=="list");
STATUSES.forEach(status=>{
const container=$({todo:"kanbanTodo",progress:"kanbanProgress",done:"kanbanDone"}[status]);
container.replaceChildren();
const tasks=filtered.filter(task=>task.status===status);
$({todo:"kanbanTodoCount",progress:"kanbanProgressCount",done:"kanbanDoneCount"}[status]).textContent=tasks.length;
if(!tasks.length)container.appendChild(element("div","column-empty","Nenhuma tarefa nesta coluna"));
tasks.forEach(task=>container.appendChild(makeKanbanCard(task)));
});
const body=$("projectTasksBody");
body.replaceChildren();
if(!filtered.length){
const row=element("tr");
const cell=element("td","empty-inline","Nenhuma tarefa encontrada.");
cell.colSpan=5;
row.appendChild(cell);
body.appendChild(row);
}else filtered.forEach(task=>body.appendChild(makeTaskRow(task,false)));
}

function renderAll(){
renderDashboard();
renderProjects();
renderGlobalTasks();
renderProjectDetail();
}

function exportBackup(){
const json=JSON.stringify(data,null,2);
const blob=new Blob([json],{type:"application/json"});
const url=URL.createObjectURL(blob);
const link=document.createElement("a");
link.href=url;
link.download="taskflow-backup-"+todayString()+".json";
document.body.appendChild(link);
link.click();
link.remove();
setTimeout(()=>URL.revokeObjectURL(url),1000);
toast("Backup gerado.");
}

async function importBackup(event){
const file=event.target.files?.[0];
event.target.value="";
if(!file)return;
if(file.size>MAX_BACKUP_SIZE){toast("O arquivo deve ter no máximo 2 MB.",true);return;}
try{
const content=await file.text();
const imported=validateData(JSON.parse(content));
confirmAction("Restaurar backup","Esta ação substituirá todos os projetos e tarefas atuais pelos dados do arquivo selecionado. Deseja continuar?",()=>{
if(updateData(imported,"Backup restaurado com sucesso.")){
currentProjectId=null;
closeModal("confirmModal");
showPage("dashboard");
}
},"Restaurar dados");
}catch(error){
toast("Não foi possível importar: "+error.message,true);
}
}

function setupDragAndDrop(){
document.querySelectorAll(".kanban-column").forEach(column=>{
column.addEventListener("dragover",event=>{
if(!draggedTaskId)return;
event.preventDefault();
event.dataTransfer.dropEffect="move";
column.classList.add("drag-over");
});
column.addEventListener("dragleave",event=>{
if(!column.contains(event.relatedTarget))column.classList.remove("drag-over");
});
column.addEventListener("drop",event=>{
event.preventDefault();
column.classList.remove("drag-over");
const id=event.dataTransfer.getData("text/plain")||draggedTaskId;
const task=getTask(id);
if(task&&task.projectId===currentProjectId)changeTaskStatus(id,column.dataset.status);
draggedTaskId=null;
});
});
}

function setupEvents(){
document.querySelectorAll("[data-page]").forEach(button=>{
button.addEventListener("click",event=>{
event.preventDefault();
showPage(button.dataset.page);
});
});
$("openSidebar").addEventListener("click",openSidebar);
$("closeSidebar").addEventListener("click",closeSidebar);
$("sidebarOverlay").addEventListener("click",closeSidebar);
["topNewProject","projectsNewProject"].forEach(id=>$(id).addEventListener("click",()=>openProjectModal()));
["dashboardNewTask","allTasksNew","detailNewTask"].forEach(id=>$(id).addEventListener("click",()=>openTaskModal()));
$("backToProjects").addEventListener("click",()=>showPage("projects"));
$("editCurrentProject").addEventListener("click",()=>openProjectModal(currentProjectId));
$("projectForm").addEventListener("submit",saveProject);
$("taskForm").addEventListener("submit",saveTask);
document.querySelectorAll("[data-close]").forEach(button=>button.addEventListener("click",()=>closeModal(button.dataset.close)));
document.querySelectorAll(".modal-backdrop").forEach(modal=>{
modal.addEventListener("click",event=>{
if(event.target===modal)closeModal(modal.id);
});
});
document.addEventListener("keydown",event=>{
if(event.key==="Escape"){
const modal=document.querySelector(".modal-backdrop:not(.hidden)");
if(modal)closeModal(modal.id);
else closeSidebar();
}
});
$("confirmAction").addEventListener("click",()=>{
if(typeof confirmCallback==="function"){
const callback=confirmCallback;
callback();
}
});
$("projectSearch").addEventListener("input",renderProjects);
["globalTaskSearch","globalStatusFilter","globalPriorityFilter","globalSort"].forEach(id=>$(id).addEventListener(id==="globalTaskSearch"?"input":"change",renderGlobalTasks));
["detailTaskSearch","detailPriorityFilter","detailSort"].forEach(id=>$(id).addEventListener(id==="detailTaskSearch"?"input":"change",renderProjectDetail));
$("kanbanViewBtn").addEventListener("click",()=>{currentView="kanban";renderProjectDetail();});
$("listViewBtn").addEventListener("click",()=>{currentView="list";renderProjectDetail();});
$("exportBackup").addEventListener("click",exportBackup);
$("importBackup").addEventListener("click",()=>$("backupFile").click());
$("backupFile").addEventListener("change",importBackup);
setupDragAndDrop();
}

setupEvents();
showPage("dashboard");
