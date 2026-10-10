import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import axios from 'axios';
import Workflow from '../WhatsAppCampaignWorkflow';
jest.mock('axios',()=>({get:jest.fn(),post:jest.fn()}));
let mockAdmin=false;
jest.mock('../../contexts/AuthContext',()=>({useAuth:()=>({user:{is_admin:mockAdmin}})}));
jest.mock('sonner',()=>({toast:{error:jest.fn(),success:jest.fn()}}));
jest.mock('../WhatsAppCampaignReport',()=>()=>null);
const props={branchId:'a',items:[{phone:'0500000001',name:'Ali'}],message:'Hi {name}',defaultName:'',audience:'pasted',onSave:jest.fn(),onMessage:jest.fn()};
beforeEach(()=>{jest.clearAllMocks();mockAdmin=false;axios.get.mockImplementation(url=>Promise.resolve({data:url.endsWith('/groups')?[]:[]}));});
test('preview never sends and shows exclusions',async()=>{
  axios.post.mockResolvedValue({data:{count:1,recipients:[{phone:'966500000001',name:'Ali',message:'Hi Ali'}],removed:{duplicates:1,invalid:0,opted_out:1}}});
  render(<Workflow {...props}/>);
  expect(screen.queryByText('استهداف اشتراكات تنتهي خلال 7 أيام')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('معاينة المستلمين والرسائل'));
  await screen.findByText('Hi Ali');
  expect(axios.post.mock.calls[0][0]).toBe('/api/whatsapp/workflow/preview');
  expect(axios.post.mock.calls[0][1]).toMatchObject({audience:'pasted',recipients:[{phone:'0500000001',name:'Ali'}]});
  fireEvent.click(screen.getByLabelText('تحديد 966500000001'));
  expect(screen.getByText('حفظ وإرسال لاعتماد المدير')).toBeDisabled();
});
test('staff cannot approve and admin sees approval',async()=>{
  axios.get.mockImplementation(url=>Promise.resolve({data:url.endsWith('/groups')?[]:[{id:'r',title:'Campaign',status:'pending_review',count:1,recipients:[]}]}));
  const view=render(<Workflow {...props}/>);
  await screen.findByText(/Campaign/);
  expect(screen.queryByText('اعتماد وإرسال / جدولة')).not.toBeInTheDocument();
  mockAdmin=true;view.rerender(<Workflow {...props}/>);
  expect(screen.getByText('اعتماد وإرسال / جدولة')).toBeInTheDocument();
});
test('changing branch clears previous preview',async()=>{
  axios.post.mockResolvedValue({data:{count:1,recipients:[{phone:'966500000001',name:'Ali',message:'Private preview'}],removed:{duplicates:0,invalid:0,opted_out:0}}});
  const view=render(<Workflow {...props}/>);
  fireEvent.click(screen.getByText('معاينة المستلمين والرسائل'));
  await screen.findByText('Private preview');
  view.rerender(<Workflow {...props} branchId="b"/>);
  await waitFor(()=>expect(screen.queryByText('Private preview')).not.toBeInTheDocument());
});
test('daily campaign preview uses the plan and supports a large reviewed audience',async()=>{
  axios.post.mockResolvedValue({data:{count:463,recipients:[{phone:'966500000001',name:'Ali',message:'Hi Ali'}],removed:{duplicates:0,invalid:0,opted_out:0}}});
  render(<Workflow {...props} spreadAcrossDays dailyRecipients={30} startDate="2099-01-01" sendTime="10:00" dailyLimit={30}/>);
  expect(screen.getByText(/1000 مستلم للحملة المقسمة/)).toBeInTheDocument();
  fireEvent.click(screen.getByText('معاينة المستلمين والرسائل'));
  await screen.findByText('Hi Ali');
  expect(axios.post.mock.calls[0][1]).toMatchObject({daily_recipients:30,start_date:'2099-01-01',send_time:'10:00'});
  expect(screen.getByText('حفظ وإرسال لاعتماد المدير')).toBeEnabled();
});

test('calendar shows campaign batches and empty dates for the selected branch',async()=>{
  axios.get.mockImplementation(url=>Promise.resolve({data:url.endsWith('/groups')?[]:[
    {id:'r',title:'October campaign',status:'queued',count:120,daily_recipients:50,start_date:'2026-10-10',recipients:[]},
  ]}));
  render(<Workflow {...props}/>);
  await screen.findAllByText(/October campaign/);
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Riyadh',year:'numeric',month:'numeric'}).formatToParts(new Date());
  const year=Number(parts.find(part=>part.type==='year').value);
  const month=Number(parts.find(part=>part.type==='month').value);
  const offset=(2026-year)*12+10-month;
  for(let step=0;step<Math.abs(offset);step++) fireEvent.click(screen.getByRole('button',{name:offset<0?'الشهر السابق':'الشهر التالي'}));
  fireEvent.click(screen.getByRole('button',{name:/2026-10-10: 50 معتمد/}));
  expect(screen.getByText(/2026-10-10 · تفاصيل الحملات/)).toBeInTheDocument();
  expect(screen.getAllByText('لا إرسال').length).toBeGreaterThan(0);
});
