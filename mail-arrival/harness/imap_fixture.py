#!/usr/bin/env python3
"""Loopback-only synthetic IMAP server. Test messages and credentials are non-production.

State is supplied as JSON, re-read for each command. This is a deliberately small
IMAP subset; unsupported operations return BAD. Do not infer provider fidelity from
this harness alone. Start inside the guarded local container, never on a host port.
"""
import argparse, base64, json, os, re, socketserver, sys, time
from datetime import datetime, timezone
from email.utils import format_datetime
from pathlib import Path

class Handler(socketserver.StreamRequestHandler):
    def state(self):
        with open(self.server.state_path, encoding='utf-8') as f: return json.load(f)
    def send(self, data):
        if isinstance(data, str): data=data.encode('utf-8')
        self.wfile.write(data); self.wfile.flush()
    def handle(self):
        self.user=None; self.folder=None
        self.send('* OK synthetic local IMAP ready\r\n')
        while True:
            line=self.rfile.readline(65537)
            if not line or len(line)>65536: return
            try:
                text=line.decode('utf-8').strip(); tag, command, *rest=text.split(' ',2)
                args=rest[0] if rest else ''; cmd=command.upper(); s=self.state()
                if cmd=='CAPABILITY': self.send('* CAPABILITY IMAP4rev1\r\n'+tag+' OK CAPABILITY\r\n')
                elif cmd=='LOGIN':
                    m=re.match(r'^"?([^" ]+)"?\s+"?([^" ]+)"?$',args)
                    if not m or m.group(1) not in s['accounts'] or m.group(2)!='synthetic-only': self.send(tag+' NO invalid fixture login\r\n')
                    else: self.user=m.group(1); self.send(tag+' OK LOGIN\r\n')
                elif cmd=='LOGOUT': self.send('* BYE closing\r\n'+tag+' OK LOGOUT\r\n'); return
                elif not self.user: self.send(tag+' NO authenticate first\r\n')
                elif cmd in ('LIST','LSUB'):
                    for folder in s['accounts'][self.user]['folders']: self.send('* LIST (\\HasNoChildren) "/" "'+folder+'"\r\n')
                    self.send(tag+' OK LIST\r\n')
                elif cmd in ('SELECT','EXAMINE'):
                    folder=args.strip('"'); account=s['accounts'][self.user]
                    if folder not in account['folders']: self.send(tag+' NO no such folder\r\n'); continue
                    self.folder=folder; rows=account['folders'][folder]['messages']; validity=account['folders'][folder]['uidvalidity']
                    self.send('* FLAGS (\\Seen)\r\n* '+str(len(rows))+' EXISTS\r\n* 0 RECENT\r\n* OK [UIDVALIDITY '+str(validity)+'] valid\r\n* OK [UIDNEXT '+str(max([m['uid'] for m in rows],default=0)+1)+'] next\r\n'+tag+' OK [READ-WRITE] SELECT\r\n')
                elif cmd=='NOOP': self.send(tag+' OK NOOP\r\n')
                elif cmd in ('CLOSE','UNSELECT'): self.folder=None; self.send(tag+' OK CLOSE\r\n')
                elif cmd=='STORE':
                    if self.server.events_path:
                        with open(self.server.events_path,'a',encoding='utf-8') as log:log.write(json.dumps({'at':datetime.now(timezone.utc).isoformat(),'run':s.get('run'),'account':self.user,'folder':self.folder,'operation':'STORE'})+'\n')
                    self.send(tag+' BAD store forbidden in read-only fixture\r\n')
                elif cmd=='UID': self.uid(tag,args,s)
                else: self.send(tag+' BAD unsupported fixture command\r\n')
            except Exception as e:
                print('fixture protocol error: '+type(e).__name__+': '+str(e),file=sys.stderr,flush=True)
                try: self.send(tag+' BAD malformed fixture request\r\n')
                except Exception: return
    def uid(self,tag,args,s):
        if not self.folder: self.send(tag+' NO select folder first\r\n'); return
        action,_,arg=args.partition(' '); action=action.upper(); rows=s['accounts'][self.user]['folders'][self.folder]['messages']
        if self.server.events_path:
            event={'at':datetime.now(timezone.utc).isoformat(),'run':s.get('run'),'account':self.user,'folder':self.folder,'operation':action}
            if action=='FETCH':
                event['kind']='header' if re.search(r'BODY(?:\.PEEK)?\[HEADER\]',arg,re.I) else 'body' if re.search(r'BODY(?:\.PEEK)?\[\]',arg,re.I) else 'metadata'
                event['uid_set']=arg.partition(' ')[0]
                if event['kind'] in ('body','header'):event['peek']=bool(re.search(r'BODY\.PEEK\[',arg,re.I))
            with open(self.server.events_path,'a',encoding='utf-8') as log: log.write(json.dumps(event)+'\n')
        delay=s.get('delays',{}).get(self.user,{}).get(action,0)
        if delay: time.sleep(delay / 1000)
        if s.get('failures',{}).get(self.user,s.get('fail'))==action: self.send(tag+' NO injected '+action+' failure\r\n'); return
        if action=='SEARCH':
            remainder=re.sub(r'\bCHARSET\s+(?:UTF-8|US-ASCII)\b|\bUID\s+\d+:(?:\d+|\*)|\bSINCE\s+"?\d{1,2}-[A-Za-z]{3}-\d{4}"?|\bX-GM-THRID\s+\d+|\b(?:ALL|UNSEEN)\b',' ',arg,flags=re.I)
            if not arg.strip() or remainder.strip(): self.send(tag+' BAD unsupported search\r\n'); return
            selected=[m for m in rows if not (re.search(r'\bUNSEEN\b',arg,re.I) and m.get('seen'))]
            group=re.search(r'\bX-GM-THRID\s+(\d+)',arg,re.I)
            if group: selected=[m for m in selected if m['gmail_thread_id']==group.group(1)]
            match=re.search(r'\bUID\s+(\d+):(\d+|\*)',arg,re.I)
            if match:
                low=int(match.group(1));high=max((m['uid'] for m in rows),default=0) if match.group(2)=='*' else int(match.group(2))
                selected=[m for m in selected if low<=m['uid']<=high]
            date_match=re.search(r'\bSINCE\s+"?(\d{1,2}-[A-Za-z]{3}-\d{4})"?',arg,re.I)
            if date_match:
                since=datetime.strptime(date_match.group(1),'%d-%b-%Y').date()
                selected=[m for m in selected if datetime.fromisoformat(m['received_at']).date()>=since]
            self.send('* SEARCH'+''.join(' '+str(m['uid']) for m in selected)+'\r\n'+tag+' OK SEARCH\r\n')
        elif action=='FETCH':
            ids,_,fields=arg.partition(' '); ids_set=set()
            for part in ids.split(','):
                if ':' in part:
                    a,b=part.split(':',1); end=max((m['uid'] for m in rows),default=0) if b=='*' else int(b);ids_set.update(range(int(a),end+1))
                else: ids_set.add(int(part))
            for seq,m in enumerate(rows,1):
                if m['uid'] not in ids_set: continue
                raw=base64.b64decode(m['raw_b64'],validate=True); flags='\\Seen' if m.get('seen') else ''
                attrs=['UID '+str(m['uid'])]
                if re.search(r'\bFLAGS\b',fields,re.I): attrs.append('FLAGS ('+flags+')')
                if re.search(r'\bINTERNALDATE\b',fields,re.I): attrs.append('INTERNALDATE "'+datetime.fromisoformat(m['received_at']).strftime('%d-%b-%Y %H:%M:%S %z')+'"')
                if re.search(r'\bRFC822\.SIZE\b',fields,re.I): attrs.append('RFC822.SIZE '+str(len(raw)))
                if re.search(r'\bX-GM-MSGID\b',fields,re.I): attrs.append('X-GM-MSGID '+m['gmail_msgid'])
                if re.search(r'\bX-GM-THRID\b',fields,re.I): attrs.append('X-GM-THRID '+m['gmail_thread_id'])
                if re.search(r'\bX-GM-LABELS\b',fields,re.I): attrs.append('X-GM-LABELS ('+' '.join('"'+x+'"' for x in m['gmail_labels'])+')')
                if re.search(r'BODY(?:\.PEEK)?\[HEADER\]',fields,re.I):
                    header=raw.split(b'\r\n\r\n',1)[0]+b'\r\n\r\n'
                    self.send(f'* {seq} FETCH ('.encode()+' '.join(attrs).encode()+f' BODY[HEADER] {{{len(header)}}}\r\n'.encode()+header+b')\r\n')
                elif re.search(r'BODY(?:\.PEEK)?\[\]',fields,re.I):
                    self.send(f'* {seq} FETCH ('.encode()+' '.join(attrs).encode()+f' BODY[] {{{len(raw)}}}\r\n'.encode()+raw+b')\r\n')
                else: self.send(f'* {seq} FETCH ('+' '.join(attrs)+')\r\n')
            self.send(tag+' OK FETCH\r\n')
        else: self.send(tag+' BAD unsupported UID command\r\n')

class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address=True; daemon_threads=True

def main():
    p=argparse.ArgumentParser();p.add_argument('--state',required=True);p.add_argument('--port',type=int,default=11430);p.add_argument('--events');a=p.parse_args()
    if not 1024<=a.port<=65535: p.error('port must be unprivileged')
    path=Path(a.state).resolve(strict=True)
    with Server(('127.0.0.1',a.port),Handler) as server:
        server.state_path=str(path);server.events_path=a.events;print(f'fixture IMAP bound 127.0.0.1:{a.port}',flush=True);server.serve_forever()
if __name__=='__main__': main()
