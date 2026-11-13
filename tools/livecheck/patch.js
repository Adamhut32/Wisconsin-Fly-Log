window.__mockPatch=(db,rpc,u)=>{Object.assign(db.profiles[0],{status:'approved',terms_version:1,last_seen_release:99,birth_year:1995,created_at:'2026-06-01T12:00:00Z',push_prefs:{friends:true,messages:true}});
 db.forum_threads=[{id:'th1',board:'driftless',user_id:u.BO,title:'Sulphurs are on at Timber Coulee',body:'Started about 7:30. #16 Sulphur Comparadun did it.',created_at:'2026-11-07T20:00:00Z',last_post_at:'2026-11-07T21:00:00Z',reply_count:1,locked:false,pinned:true,hidden:false},
   {id:'th2',board:'flies',user_id:u.CY,title:'Best scud pattern for winter?',body:'Looking for ideas.',created_at:'2026-11-06T20:00:00Z',last_post_at:'2026-11-06T20:00:00Z',reply_count:0,locked:false,pinned:false,hidden:false}];
 db.forum_posts=[{id:'po1',thread_id:'th1',user_id:u.CY,body:'Nice! What tippet?',created_at:'2026-11-07T21:00:00Z',hidden:false}];
 db.messages=[{id:'m1',from_user:u.BO,to_user:u.ME,body:'You fishing Saturday?',created_at:'2026-11-07T22:00:00Z',read_at:null,hidden:false},{id:'m2',from_user:u.ME,to_user:u.BO,body:'Yes, 6am at the bridge',created_at:'2026-11-07T22:05:00Z',read_at:'2026-11-07T22:06:00Z',hidden:false}];
 db.user_blocks=[];
 rpc.my_conversations=[{other:u.BO,display_name:'Bo Larson',avatar_path:null,last_body:'You fishing Saturday?',last_at:'2026-11-07T22:00:00Z',last_from_me:false,unread:1,can_message:true}];
 rpc.can_message=null;
 rpc.report_queue=[{id:'r1',kind:'post',ref:'po9',reason:'Rude or harassing',status:'open',created_at:'2026-11-07T22:00:00Z',reporter_name:'Bo Larson',author:u.CY,author_name:'Cy',content:'You are a d******* for keeping that fish',context:'Sulphurs are on',is_hidden:false,reports:2}];
 rpc.moderate=null; rpc.push_test=null;
};