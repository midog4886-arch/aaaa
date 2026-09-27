import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import SocialEditorialHub from '../SocialEditorialHub';
jest.mock('axios',()=>({get:jest.fn(),post:jest.fn(),put:jest.fn()}));
jest.mock('sonner',()=>({toast:{success:jest.fn(),error:jest.fn()}}));
jest.mock('../../contexts/AuthContext',()=>({useAuth:()=>({user:{id:'staff',is_admin:false},selectedBranchId:'north'})}));
const payload={media_filename:'m.png',caption:'Academy news',targets:[{platform:'facebook',caption_override:'Facebook version'}]};
beforeEach(()=>{jest.clearAllMocks();axios.get.mockResolvedValue({data:[]});});
test('shows per-platform caption preview without publishing',async()=>{
  render(<SocialEditorialHub payload={payload} media={{filename:'m.png',kind:'image',public_url:'/m.png'}} onRestore={jest.fn()} onCaption={jest.fn()}/>);
  fireEvent.click(screen.getByText('معاينة المنصات'));
  await act(async()=>{});
  expect(screen.getByText('Facebook version')).toBeInTheDocument();
  expect(axios.post).not.toHaveBeenCalled();
});
test('saves a branch-scoped draft with the current editor payload',async()=>{
  axios.post.mockResolvedValue({data:{id:'p',revision:1}});
  render(<SocialEditorialHub payload={payload} onRestore={jest.fn()} onCaption={jest.fn()}/>);
  fireEvent.change(screen.getByLabelText('عنوان المسودة'),{target:{value:'News'}});
  fireEvent.click(screen.getByText('حفظ مسودة من محرر المنشور أدناه'));
  await waitFor(()=>expect(axios.post).toHaveBeenCalledWith('/api/social/workflow/plans',expect.objectContaining({title:'News',branch_id:'north',payload,schedule_at:null})));
});
test('does not show administrative approval actions to staff',async()=>{
  axios.get.mockImplementation(url=>Promise.resolve({data:url.endsWith('/plans')?[{id:'p',title:'Review me',status:'pending_review',results:{}}]:[]}));
  render(<SocialEditorialHub payload={payload} onRestore={jest.fn()} onCaption={jest.fn()}/>);
  await screen.findByText('Review me');
  expect(screen.queryByText('اعتماد')).not.toBeInTheDocument();
});
