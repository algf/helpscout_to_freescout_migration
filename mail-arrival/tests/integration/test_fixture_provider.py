import base64, imaplib, json, socket, subprocess, sys, tempfile, time, unittest
from datetime import datetime, timezone, timedelta
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'fixtures'))
from make_state import build, build_folder_scenario, message

class FixtureProviderTest(unittest.TestCase):
    def test_sent_policy_uses_synthetic_identity(self):
        row=message('fixture-sent-test',3,'policy-sent',7)
        self.assertEqual(row['gmail_labels'],['Sent'])
        self.assertIn(b'From: fixture-team@arrival.invalid\r\n',base64.b64decode(row['raw_b64']))

    def test_run_identity_is_stable_and_separate(self):
        a=build('fixture-run-one');repeat=build('fixture-run-one');other=build('fixture-run-two')
        for mailbox in (1,2,3):
            folder=lambda x:x['accounts'][f'fixture-{mailbox}']['folders']['INBOX']
            aa,rr,bb=folder(a),folder(repeat),folder(other)
            self.assertEqual(aa['uidvalidity'],rr['uidvalidity']);self.assertNotEqual(aa['uidvalidity'],bb['uidvalidity'])
            self.assertEqual(aa['messages'][0]['gmail_msgid'],rr['messages'][0]['gmail_msgid']);self.assertNotEqual(aa['messages'][0]['gmail_msgid'],bb['messages'][0]['gmail_msgid'])
            self.assertEqual(aa['messages'][0]['gmail_thread_id'],aa['messages'][1]['gmail_thread_id'])
            self.assertLess(int(aa['messages'][0]['gmail_msgid']),2**63)
    def test_named_folders_have_bounded_cross_folder_replay(self):
        state=build_folder_scenario('fixture-folders1');two=state['accounts']['fixture-2']['folders'];three=state['accounts']['fixture-3']['folders']
        self.assertEqual(two['INBOX']['messages'][0]['gmail_msgid'],two['FreeScout-Crockd-Pilot']['messages'][0]['gmail_msgid'])
        self.assertEqual(three['[Gmail]/All Mail']['messages'][0]['gmail_msgid'],three['[Gmail]/Spam']['messages'][0]['gmail_msgid'])
        self.assertNotEqual(three['[Gmail]/Spam']['messages'][1]['gmail_msgid'],three['[Gmail]/Bin']['messages'][0]['gmail_msgid'])

    def test_named_gmail_folders_over_imap(self):
        with tempfile.TemporaryDirectory() as d:
            state=Path(d)/'state.json';data=build_folder_scenario('fixture-folders1');state.write_text(json.dumps(data))
            with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
            proc=subprocess.Popen([sys.executable,str(ROOT/'harness/imap_fixture.py'),'--state',str(state),'--port',str(port)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            try:
                self.assertIn('127.0.0.1',proc.stdout.readline());client=imaplib.IMAP4('127.0.0.1',port);client.login('fixture-3','synthetic-only')
                for folder,count in [('[Gmail]/All Mail',2),('[Gmail]/Spam',2),('[Gmail]/Bin',1)]:
                    self.assertEqual(client.select('"'+folder+'"')[1],[str(count).encode()])
                client.logout()
            finally:
                proc.terminate();proc.wait(timeout=5);proc.stdout.close();proc.stderr.close()

    def test_protocol_read_seen_failure_and_uidvalidity(self):
        with tempfile.TemporaryDirectory() as d:
            state=Path(d)/'state.json'; data=build('fixture-test1234')
            rows=data['accounts']['fixture-1']['folders']['INBOX']['messages'];rows[0]['received_at']=(datetime.now(timezone.utc)-timedelta(days=45)).isoformat();state.write_text(json.dumps(data))
            with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
            proc=subprocess.Popen([sys.executable,str(ROOT/'harness/imap_fixture.py'),'--state',str(state),'--port',str(port)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            try:
                self.assertIn('127.0.0.1',proc.stdout.readline())
                client=imaplib.IMAP4('127.0.0.1',port);self.assertEqual(client.login('fixture-1','synthetic-only')[0],'OK')
                self.assertEqual(client.select('INBOX')[1],[b'4']);self.assertEqual(client.response('UIDVALIDITY')[1],[str(data['accounts']['fixture-1']['folders']['INBOX']['uidvalidity']).encode()])
                self.assertEqual(client.uid('SEARCH',None,'ALL')[1],[b'1 2 3 4'])
                self.assertEqual(client.uid('SEARCH',None,'UNSEEN')[1],[b'1 2 3'])
                gid=rows[0]['gmail_thread_id'];self.assertEqual(client.uid('SEARCH',None,'X-GM-THRID',gid)[1],[b'1 2'])
                with self.assertRaises(imaplib.IMAP4.error):client.uid('SEARCH',None,'X-UNKNOWN','123')
                since=(datetime.now(timezone.utc)-timedelta(days=3)).strftime('%d-%b-%Y')
                self.assertEqual(client.uid('SEARCH',None,'UID','1:3','SINCE',since)[1],[b'2 3'])
                self.assertEqual(client.uid('SEARCH',None,'UID','4:4','SINCE',since)[1],[b'4']) # Old Date header, recent INTERNALDATE.
                tomorrow=(datetime.now(timezone.utc)+timedelta(days=1)).strftime('%d-%b-%Y')
                self.assertEqual(client.uid('SEARCH',None,'UID','3:3','SINCE',tomorrow)[1],[b'']) # Future Date header, recent INTERNALDATE.
                typ,meta=client.uid('FETCH','4','(UID INTERNALDATE FLAGS X-GM-MSGID X-GM-THRID X-GM-LABELS)');self.assertEqual(typ,'OK');self.assertIn(b'INTERNALDATE',meta[0]);self.assertIn(b'X-GM-MSGID',meta[0]);self.assertIn(b'X-GM-THRID',meta[0]);self.assertIn(b'X-GM-LABELS',meta[0]);self.assertIn(b'\\Seen',meta[0])
                typ, fetched=client.uid('FETCH','3','(UID BODY.PEEK[])');self.assertEqual(typ,'OK');self.assertIn(b'arrival-fixture.bin',fetched[0][1]);self.assertTrue(json.loads(state.read_text())['accounts']['fixture-1']['folders']['INBOX']['messages'][3]['seen'])
                data['failures']={'fixture-1':'SEARCH'};state.write_text(json.dumps(data));self.assertEqual(client.uid('SEARCH',None,'ALL')[0],'NO')
                other=imaplib.IMAP4('127.0.0.1',port);other.login('fixture-2','synthetic-only');other.select('INBOX');self.assertEqual(other.uid('SEARCH',None,'ALL')[1],[b'1 2 3 4']);other.logout()
                data['failures']['fixture-1']=None;data['accounts']['fixture-1']['folders']['INBOX']['uidvalidity']=2001;state.write_text(json.dumps(data))
                client.select('INBOX');self.assertEqual(client.response('UIDVALIDITY')[1],[b'2001']);client.logout()
            finally:
                proc.terminate();proc.wait(timeout=5)
                proc.stdout.close();proc.stderr.close()

if __name__=='__main__':unittest.main()
