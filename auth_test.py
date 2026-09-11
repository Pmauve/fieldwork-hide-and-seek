import hashlib
import http.client
import json
import secrets
import tempfile
import threading
import time
import unittest
from pathlib import Path
from auth import Auth, COOKIE, password_hash, totp

class AuthTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = Path(self.temp.name) / 'auth.sqlite3'
        self.password = 'test-only-password-123'
        self.config = {'salt': '11'*16, 'password_hash':password_hash(self.password,'11'*16), 'totp_secret':'JBSWY3DPEHPK3PXP', 'expires_at':time.time()+3600, 'origins':['https://example.test:10000']}
        self.auth = Auth(self.db, self.config)

    def tearDown(self):
        self.temp.cleanup()

    def login(self):
        return self.auth.login(self.password, totp(self.config['totp_secret'],int(time.time()//30)))

    def test_password_and_otp_both_required(self):
        with self.assertRaises(ValueError): self.auth.login('wrong',totp(self.config['totp_secret'],int(time.time()//30)))
        with self.assertRaises(ValueError): self.auth.login(self.password,'not-a-code')
        token,_=self.login()
        self.assertIsNotNone(self.auth.session(f'{COOKIE}={token}'))

    def test_code_replay_rejected_and_logout_revokes(self):
        token,_=self.login()
        with self.assertRaises(ValueError): self.login()
        cookie=f'{COOKIE}={token}'
        self.auth.logout(cookie)
        self.assertIsNone(self.auth.session(cookie))

    def test_sessions_are_hashed_durable_and_expire(self):
        token,_=self.login()
        with self.auth.connect() as db:
            row=db.execute('SELECT token FROM auth_sessions').fetchone()[0]
        self.assertEqual(row,hashlib.sha256(token.encode()).hexdigest())
        self.assertIsNotNone(Auth(self.db,self.config).session(f'{COOKIE}={token}'))
        self.config['expires_at']=time.time()-1
        self.assertIsNone(self.auth.session(f'{COOKIE}={token}'))
        with self.assertRaises(ValueError):self.login()

    def test_origin_allowlist(self):
        self.assertTrue(self.auth.origin_allowed({'Origin':'https://example.test:10000'}))
        self.assertFalse(self.auth.origin_allowed({'Origin':'https://evil.test'}))
        self.assertFalse(self.auth.origin_allowed({}))

    def test_rate_limit_is_persistent(self):
        with self.auth.connect() as db:
            db.executemany('INSERT INTO auth_attempts VALUES (?)',[(time.time(),)]*20)
        with self.assertRaisesRegex(ValueError,'Too many'):self.login()

    def test_totp_rfc6238_vector(self):
        self.assertEqual(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',1),'287082')

    def test_http_auth_cookie_and_csrf(self):
        import os
        os.environ['AUTH_DISABLED_FOR_TESTS']='1'
        os.environ.setdefault('DATA_DIR',self.temp.name)
        import server
        old=server.auth
        server.auth=self.auth
        http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        thread=threading.Thread(target=http.serve_forever,daemon=True);thread.start()
        def request(method,path,data=None,headers=None):
            connection=http_client=http_module.HTTPConnection('127.0.0.1',http.server_port,timeout=3)
            try:
                connection.request(method,path,json.dumps(data) if data else None,headers or {})
                response=connection.getresponse();body=response.read()
                return response.status,dict(response.getheaders()),body
            finally:connection.close()
        import http.client as http_module
        try:
            self.assertEqual(request('GET','/api/workbook')[0],401)
            payload={'password':self.password,'code':totp(self.config['totp_secret'],int(time.time()//30))}
            status,headers,_=request('POST','/auth/login',payload,{'Content-Type':'application/json','Origin':self.config['origins'][0]})
            self.assertEqual(status,200)
            cookie=headers['Set-Cookie']
            for flag in ['Secure','HttpOnly','SameSite=Strict','Path=/']:self.assertIn(flag,cookie)
            session_cookie=cookie.split(';')[0]
            self.assertEqual(request('GET','/api/workbook',headers={'Cookie':session_cookie})[0],200)
            self.assertEqual(request('POST','/api/workbook',{'x':1},{'Cookie':session_cookie,'Content-Type':'application/json','Origin':self.config['origins'][0]})[0],403)
            _,_,body=request('GET','/auth/session',headers={'Cookie':session_cookie})
            csrf=json.loads(body)['csrf']
            self.assertEqual(request('POST','/auth/logout',{'logout':True},{'Cookie':session_cookie,'Content-Type':'application/json','Origin':self.config['origins'][0],'X-Fieldwork-CSRF':csrf})[0],200)
            self.assertEqual(request('GET','/api/workbook',headers={'Cookie':session_cookie})[0],401)
        finally:
            http.shutdown();http.server_close();server.auth=old

    def test_native_form_login_redirects_without_putting_credentials_in_url(self):
        import os,urllib.parse
        os.environ['AUTH_DISABLED_FOR_TESTS']='1'
        os.environ.setdefault('DATA_DIR',self.temp.name)
        import server
        old=server.auth;server.auth=self.auth
        http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        threading.Thread(target=http.serve_forever,daemon=True).start()
        import http.client as client
        connection=client.HTTPConnection('127.0.0.1',http.server_port,timeout=5)
        try:
            body=urllib.parse.urlencode({'username':'players','password':self.password,'code':totp(self.config['totp_secret'],int(time.time()//30))})
            connection.request('POST','/auth/login',body,{'Content-Type':'application/x-www-form-urlencoded','Origin':self.config['origins'][0]})
            response=connection.getresponse();response.read()
            self.assertEqual(response.status,303)
            self.assertEqual(response.getheader('Location'),'/')
            self.assertIn('HttpOnly',response.getheader('Set-Cookie'))
        finally:
            connection.close();http.shutdown();http.server_close();server.auth=old

if __name__=='__main__':unittest.main()
