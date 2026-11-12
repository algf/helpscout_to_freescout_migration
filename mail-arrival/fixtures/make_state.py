#!/usr/bin/env python3
"""Generate a private, synthetic-only IMAP state. No external addresses or credentials."""
import argparse, base64, hashlib, json, re, secrets
from datetime import datetime, timezone, timedelta
from email.message import EmailMessage
from email import policy
from email.utils import format_datetime
from pathlib import Path

def message(run, mailbox, kind, uid, recipients=None):
    msg=EmailMessage(policy=policy.SMTP); ident=f'{run}-{mailbox}-{kind}@arrival.invalid'
    msg['From']='fixture-team@arrival.invalid' if mailbox==3 and kind=='policy-sent' else f'Fixture {mailbox} <sender-{mailbox}@arrival.invalid>'
    msg['To']=', '.join(recipients) if recipients else f'mailbox-{mailbox}@arrival.invalid'
    msg['Subject']=f'Arrival fixture {run} mailbox {mailbox} {kind}'
    received=datetime.now(timezone.utc).replace(microsecond=0)
    # Source Date deliberately differs from receipt; it is not an arrival metric.
    source_date=received-timedelta(days=30) if kind=='read' else received+timedelta(days=2) if kind=='attachment' else received
    msg['Date']=format_datetime(source_date); msg['Message-ID']=f'<{ident}>'
    if kind=='reply':
        parent=f'<{run}-{mailbox}-new@arrival.invalid>';msg['In-Reply-To']=parent;msg['References']=parent
    msg.set_content(f'Synthetic arrival fixture {run} {mailbox} {kind}.')
    if kind=='attachment': msg.add_attachment(b'local-synthetic-attachment\n',maintype='application',subtype='octet-stream',filename='arrival-fixture.bin')
    base=int(hashlib.sha256(run.encode()).hexdigest()[:12],16)*10000+mailbox*1000
    return {'uid':uid,'seen':kind=='read','message_id':ident,'received_at':received.isoformat(),'gmail_msgid':str(base+uid),'gmail_thread_id':str(base+(1 if kind=='reply' else uid)),'gmail_labels':({'policy-archived':[], 'policy-sent':['Sent'], 'policy-spam':['Spam'], 'policy-trash':['Trash'], 'policy-draft':['Draft']}.get(kind,['Inbox'])), 'raw_b64':base64.b64encode(msg.as_bytes()).decode('ascii')}

def build(run):
    if not re.fullmatch(r'[a-z0-9-]{8,40}',run): raise ValueError('run must be 8–40 lowercase letters, digits or hyphens')
    return {'run':run,'accounts':{f'fixture-{i}':{'folders':{'INBOX':{'uidvalidity':int(hashlib.sha256(run.encode()).hexdigest()[:7],16)*4+i,'messages':[message(run,i,kind,n) for n,kind in enumerate(('new','reply','attachment','read'),1)]}}} for i in (1,2,3)}}

def build_folder_scenario(run):
    """Synthetic real-named folder layout, including a deliberate cross-folder replay."""
    state=build(run); seed=int(hashlib.sha256(run.encode()).hexdigest()[:7],16)*4
    def folder(mailbox,name,offset,records):
        state['accounts'][f'fixture-{mailbox}']['folders'][name]={'uidvalidity':seed+offset,'messages':records}
    def item(mailbox,kind,gid_uid,local_uid,labels):
        result=message(run,mailbox,kind,gid_uid);result['uid']=local_uid;result['gmail_labels']=labels;return result
    # Reuse the exact same message identity and MIME in two folders to test deduplication.
    pilot_duplicate=dict(state['accounts']['fixture-2']['folders']['INBOX']['messages'][0]);pilot_duplicate['uid']=1
    folder(2,'FreeScout-Crockd-Pilot',102,[pilot_duplicate,item(2,'folder-pilot',101,2,['Inbox'])])
    shared=item(3,'folder-shared',101,1,['Inbox']);shared_copy=dict(shared)
    folder(3,'[Gmail]/All Mail',103,[shared,item(3,'folder-archived',102,2,[])])
    folder(3,'[Gmail]/Spam',203,[shared_copy,item(3,'folder-spam',103,2,['Spam'])])
    folder(3,'[Gmail]/Bin',303,[item(3,'folder-trash',104,1,['Trash'])])
    return state

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('output');p.add_argument('--run',default='fixture-'+secrets.token_hex(6));p.add_argument('--scenario',choices=['standard','folders'],default='standard');a=p.parse_args();out=Path(a.output)
    with out.open('x',encoding='utf-8') as f:json.dump(build_folder_scenario(a.run) if a.scenario=='folders' else build(a.run),f,indent=2)
    out.chmod(0o600); print('Created synthetic fixture state:',out,'run:',a.run)
