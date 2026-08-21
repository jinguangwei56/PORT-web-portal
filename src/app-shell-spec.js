// Portal application shell specification v1.1.
export const APP_SHELL = {
  name: 'FONKON Market Development',
  navigation: [
    {id:'today', label:'今日任务'},
    {id:'customers', label:'客户'},
    {id:'new-customer', label:'新增客户'},
    {id:'interview', label:'客户访谈'},
    {id:'opportunities', label:'商机'},
    {id:'dashboard', label:'主管看板'}
  ],
  customerCard: ['customerName','coreFruit','currentPort','cv','grade','ot','pi','aq','warning','nextAction'],
  scoreLabels: {cv:'客户价值', ot:'商机热度', pi:'商机优先级', aq:'可争取柜量'},
  warnings: {RED:'需要补数据/低成本维护',YELLOW:'验证与补证据',GREEN:'重点推进'}
};
