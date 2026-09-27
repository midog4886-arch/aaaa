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
  fireEvent.click(screen.getByText('معاينة المستلمين والرسائل'));
  await screen.findByText('Hi Ali');
  expect(axios.post.mock.calls[0][0]).toBe('/api/whatsapp/workflow/preview');
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
