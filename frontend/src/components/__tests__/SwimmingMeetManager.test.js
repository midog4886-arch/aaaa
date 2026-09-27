import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import SwimmingMeetManager, { rankEntries } from '../SwimmingMeetManager';
jest.mock('axios', () => ({ get: jest.fn(), put: jest.fn() }));
jest.mock('sonner', () => ({ toast: { success:jest.fn(), error:jest.fn(), warning:jest.fn() } }));
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ selectedBranchId:'north',user:{id:'staff'} }) }));
const meet={name:'Swimming meet',date:'2026-09-27',place:'Pool',revision:0,pool_length:25,lanes:6,approved:false,races:[],swimmers:[],entries:[]};
beforeEach(()=>{jest.clearAllMocks();axios.get.mockResolvedValue({data:meet});Object.defineProperty(window,'crypto',{configurable:true,value:{randomUUID:()=> 'race-1'}});});
test('rankings preserve ties and omit unfinished and unsaved times',()=>{
  expect(rankEntries([{id:'1',status:'finished',time_cs:100},{id:'2',status:'finished',time_cs:100},{id:'3',status:'finished',time_cs:110},{id:'4',status:'dns',time_cs:null}]).map(e=>e.place)).toEqual([1,1,3,null]);
  expect(rankEntries([{id:'1',status:'finished',time_cs:null}])[0].place).toBeNull();
});
test('opens lazily, creates a race and saves a draft with revision',async()=>{
  axios.put.mockImplementation((path,data)=>Promise.resolve({data:{...data,revision:1,conflicts:[]}}));
  render(<SwimmingMeetManager tid="t"/>);
  expect(axios.get).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('إدارة بطولة السباحة 🏊'));
  await screen.findByText('إعداد المسبح');
  await waitFor(()=>expect(screen.queryByRole('status')).not.toBeInTheDocument());
  fireEvent.click(screen.getByText('السباقات'));
  fireEvent.click(screen.getByText('إضافة السباق'));
  expect(screen.getByText('تعديلات غير محفوظة')).toBeInTheDocument();
  fireEvent.click(screen.getByText('حفظ المسودة'));
  await waitFor(()=>expect(axios.put).toHaveBeenCalledWith('/api/tournaments/t/swimming',expect.objectContaining({revision:0,approved:false,races:[expect.objectContaining({id:'race-1',distance:50})]}),{params:{auto_seed:false}}));
});
test('shows conflicting edit errors without claiming a save',async()=>{
  axios.put.mockRejectedValue({response:{data:{detail:'عدّل موظف آخر البطولة'}}});
  render(<SwimmingMeetManager tid="t"/>);
  fireEvent.click(screen.getByText('إدارة بطولة السباحة 🏊'));
  await screen.findByText('إعداد المسبح');
  await waitFor(()=>expect(screen.queryByRole('status')).not.toBeInTheDocument());
  fireEvent.click(screen.getByText('حفظ المسودة'));
  expect(await screen.findByRole('alert')).toHaveTextContent('عدّل موظف آخر البطولة');
});
