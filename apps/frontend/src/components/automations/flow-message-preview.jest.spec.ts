export {};
jest.mock('canvas',()=>null);
jest.mock('@gitroom/react/translation/get.transation.service.client',()=>({useT:()=> (_:string,fallback:string)=>fallback}));
const {JSDOM}=require('jsdom');
const dom=new JSDOM('<html><body></body></html>',{url:'http://localhost'});
Object.assign(global,{window:dom.window,document:dom.window.document,MutationObserver:dom.window.MutationObserver});
Object.defineProperty(global,'navigator',{value:dom.window.navigator,configurable:true});
(global as any).IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react');
const {render,screen,cleanup,fireEvent}=require('@testing-library/react');
const {FlowMessagePreview}=require('./flow-message-preview');
afterEach(()=>cleanup());
const node=(id:string,type:string,config:any)=>({id,type,data:{config:JSON.stringify(config)}});
it('shows text messages separately in graph order, including a reply wait',()=>{
  const nodes=[node('b','sendDm',{message:'Reminder'}),node('t','trigger',{}),node('a','sendDm',{message:'Invitation'}),node('w','waitReply',{mode:'reply',timeoutHours:12})];
  render(React.createElement(FlowMessagePreview,{nodes,edges:[{source:'t',target:'a'},{source:'a',target:'w'},{source:'w',target:'b'}],onClose:()=>{}}));
  const text=screen.getByRole('region').textContent;
  expect(text.indexOf('Invitation')).toBeLessThan(text.indexOf('Wait for reply'));
  expect(text.indexOf('Wait for reply')).toBeLessThan(text.indexOf('Reminder'));
  expect(screen.getByText('Invitation').parentElement).not.toBe(screen.getByText('Reminder').parentElement);
});
it('previews chosen media and never sends a message',()=>{
  const close=jest.fn();
  render(React.createElement(FlowMessagePreview,{nodes:[node('t','trigger',{}),node('m','sendDm',{media:{id:'m',type:'image',path:'https://cdn.example.com/x.png'}})],edges:[{source:'t',target:'m'}],onClose:close}));
  expect(screen.getByRole('img',{name:'Image'}).getAttribute('src')).toBe('https://cdn.example.com/x.png');
  expect(screen.getByText(/Nothing is sent/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Close'}));expect(close).toHaveBeenCalledTimes(1);
});
