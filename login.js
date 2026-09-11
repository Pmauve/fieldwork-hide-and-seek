document.getElementById('login').addEventListener('submit', async event => {
  event.preventDefault();
  const button=document.getElementById('submit'), error=document.getElementById('error');
  button.disabled=true;error.textContent='';
  try {
    const response=await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.getElementById('password').value,code:document.getElementById('code').value}),signal:AbortSignal.timeout(15000)});
    let data;try{data=await response.json();}catch{throw new Error('Too many requests or temporary connection issue. Wait a minute and retry.');}
    if(!response.ok)throw new Error(data.error||'Sign-in failed');
    location.replace('/');
  } catch(e){error.textContent=e.message;document.getElementById('code').value='';button.disabled=false;}
});
