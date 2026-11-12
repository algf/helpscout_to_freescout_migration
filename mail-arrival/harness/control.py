#!/usr/bin/env python3
"""Change only local synthetic provider state for recovery and failure tests."""
import argparse,fcntl,json,os,re,tempfile
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--state',required=True);p.add_argument('--mailbox',type=int,choices=[1,2,3],required=True);g=p.add_mutually_exclusive_group(required=True);g.add_argument('--fail',choices=['SEARCH','FETCH','off']);g.add_argument('--uidvalidity',type=int);g.add_argument('--seen',type=int);g.add_argument('--delay-search-ms',type=int);g.add_argument('--copy-from-mailbox1-uid',type=int);a=p.parse_args()
path=Path(a.state).resolve(strict=True)
if not re.fullmatch(r'/tmp/mail-arrival-[a-z0-9-]{8,40}/state\.json',str(path)):p.error('fixture state path required')
with open(str(path)+'.lock','a') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX);state=json.loads(path.read_text());folder=state['accounts'][f'fixture-{a.mailbox}']['folders']['INBOX']
 if a.fail: state.setdefault('failures',{})[f'fixture-{a.mailbox}']=None if a.fail=='off' else a.fail
 elif a.delay_search_ms is not None:
  if not 0<=a.delay_search_ms<=10000:p.error('delay must be 0–10000 ms')
  state.setdefault('delays',{}).setdefault(f'fixture-{a.mailbox}',{})['SEARCH']=a.delay_search_ms
 elif a.copy_from_mailbox1_uid is not None:
  if a.mailbox!=2:p.error('cross-mail copy target must be mailbox 2')
  origin=[x for x in state['accounts']['fixture-1']['folders']['INBOX']['messages'] if x['uid']==a.copy_from_mailbox1_uid]
  if len(origin)!=1 or not re.search(r'-1-cross-(?:mail|race)@arrival\.invalid$',origin[0]['message_id']):raise SystemExit('source must be the unique cross-mail fixture')
  if any(x['gmail_msgid']==origin[0]['gmail_msgid'] for x in folder['messages']):raise SystemExit('cross-mail already copied')
  record=dict(origin[0]);record['uid']=max((x['uid'] for x in folder['messages']),default=0)+1;folder['messages'].append(record)
 elif a.uidvalidity is not None:
  if a.uidvalidity<1:p.error('positive UIDVALIDITY required')
  folder['uidvalidity']=a.uidvalidity
 else:
  matching=[x for x in folder['messages'] if x['uid']==a.seen]
  if len(matching)!=1:raise SystemExit('UID must select exactly one fixture')
  matching[0]['seen']=True
 fd,tmp=tempfile.mkstemp(prefix='.state-',dir=path.parent)
 try:
  with os.fdopen(fd,'w') as out:json.dump(state,out);out.flush();os.fsync(out.fileno())
  os.chmod(tmp,0o600);os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
 print(json.dumps({'run':state['run'],'mailbox':a.mailbox,'failure':state.get('failures',{}).get(f'fixture-{a.mailbox}'),'uidvalidity':folder['uidvalidity'],'seen_uid':a.seen,'delay_search_ms':a.delay_search_ms}))
