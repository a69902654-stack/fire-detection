(function(){
    const setupModal = document.getElementById('setupModal');
    const mainApp = document.getElementById('mainApp');
    const setupBotToken = document.getElementById('setupBotToken');
    const setupChatId = document.getElementById('setupChatId');
    const setupCameraIp = document.getElementById('setupCameraIp');
    const saveSetupBtn = document.getElementById('saveSetupBtn');
    
    const gridEl = document.getElementById('camGrid');
    const totalSpan = document.getElementById('totalCamsBadge');
    const newIpInput = document.getElementById('newIpInput');
    const addBtn = document.getElementById('addCamBtn');
    const addDefaultBtn = document.getElementById('addDefaultBtn');
    const stopAllBtn = document.getElementById('stopAllBtn');
    const telegramStatusDiv = document.getElementById('telegramStatus');
    const logArea = document.getElementById('logArea');
    
    let cameras = [];
    let nextId = 1;
    let botToken = "";
    let mainChatId = "";
    let recipients = [];  
    let lastAlertSentForCam = {};
    let alertThreshold = 55;  
    
    function addLog(msg, isError=false){
        const time = new Date().toLocaleTimeString('fa-IR');
        const logMsg = `[${time}] ${msg}`;
        logArea.innerHTML += `<div style="color:${isError?'#f87171':'#86efac'}">${logMsg}</div>`;
        logArea.scrollTop = logArea.scrollHeight;
        console.log(logMsg);
    }
    
    function saveUserData(){
        const userData = {
            botToken: botToken,
            chatId: mainChatId,
            recipients: recipients,
            threshold: alertThreshold,
            isConfigured: true
        };
        localStorage.setItem('fireAlertUserData', JSON.stringify(userData));
    }
    
    function loadUserData(){
        const saved = localStorage.getItem('fireAlertUserData');
        if(saved){
            try{
                const data = JSON.parse(saved);
                if(data.botToken) botToken = data.botToken;
                if(data.chatId) mainChatId = data.chatId;
                if(data.recipients) recipients = data.recipients;
                if(data.threshold) alertThreshold = data.threshold;
                return true;
            }catch(e){}
        }
        return false;
    }
    
    function isUserConfigured(){
        const data = localStorage.getItem('fireAlertUserData');
        if(!data) return false;
        try{
            const parsed = JSON.parse(data);
            return !!(parsed.botToken && parsed.chatId);
        }catch(e){
            return false;
        }
    }
    
    function saveInitialSetup(){
        const token = setupBotToken.value.trim();
        const chat = setupChatId.value.trim();
        const camIp = setupCameraIp.value.trim();
        
        if(!token || !chat){
            alert("لطفاً توکن بات و آیدی عددی خود را وارد کنید");
            return;
        }
        
        botToken = token;
        mainChatId = chat;
        alertThreshold = 55;
        recipients = [];
        
        saveUserData();
        
        setupModal.style.display = 'none';
        mainApp.style.display = 'block';
        
        addLog("✅ اطلاعات با موفقیت ذخیره شد");
        updateTelegramStatus();
        
        if(camIp){
            setTimeout(()=> addCamera(camIp), 500);
        } else {
            setTimeout(()=> addCamera("http://192.168.1.3:8080/video"), 500);
        }
    }
    
    function updateTelegramStatus(){
        if(botToken && mainChatId){
            telegramStatusDiv.innerHTML = '✅ سیستم پیام رسان فعال است - در صورت تشخیص حریق، پیام ارسال می‌شود';
            telegramStatusDiv.style.background = '#064e3b';
        }else{
            telegramStatusDiv.innerHTML = '⚠️ سیستم پیام رسان غیرفعال - لطفاً برنامه را مجدداً راه‌اندازی کنید';
            telegramStatusDiv.style.background = '#1e293b';
        }
    }
    
    async function sendTelegramMessage(chatId, message){
        if(!botToken || !chatId){
            return false;
        }
        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
        try{
            const response = await fetch(url, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    chat_id: chatId,
                    text: message,
                    parse_mode: 'HTML'
                })
            });
            const result = await response.json();
            if(result.ok){
                return true;
            } else {
                return false;
            }
        } catch(err){
            return false;
        }
    }
    
    async function sendToAllRecipients(message){
        let sentCount = 0;
        if(mainChatId){
            const res = await sendTelegramMessage(mainChatId, message);
            if(res) sentCount++;
        }
        for(let rec of recipients){
            if(rec.id){
                const res = await sendTelegramMessage(rec.id, message);
                if(res) sentCount++;
            }
        }
        if(sentCount > 0){
            addLog(`📨 پیام هشدار به ${sentCount} نفر ارسال شد`);
            const notif = document.createElement('div');
            notif.style.cssText = 'position:fixed;top:20px;right:20px;background:#dc2626;color:white;padding:10px 18px;border-radius:16px;z-index:9999;font-size:0.8rem;';
            notif.innerHTML = `📨 هشدار به ${sentCount} نفر ارسال شد!`;
            document.body.appendChild(notif);
            setTimeout(()=>notif.remove(), 3000);
        }
        return sentCount;
    }
    
    const SENSITIVITY = 42;
    function calcHeatScore(r,g,b){
        let score=0;
        if(r>180 && g<r*0.85 && b<r*0.6){
            score=Math.min(100, Math.floor((r-140)/1.2));
            if(g>r*0.4 && g<r*0.75) score=Math.min(100,score+10);
        }
        else if(r>150 && g>r*0.45 && g<r*0.88 && b<r*0.65 && r>g+25){
            score=Math.min(100, Math.floor((r-120)/1.5)+20);
        }
        else if(r>200 && g>120 && g<190 && b<120){
            score=75;
        }
        return score>SENSITIVITY ? score : 0;
    }
    
    function analyzeHeat(imgData){
        const w=imgData.width, h=imgData.height, data=imgData.data;
        let heatPixels=0, totalHeat=0, maxHeat=0;
        const step=3;
        for(let y=0;y<h;y+=step){
            for(let x=0;x<w;x+=step){
                const idx=(y*w+x)*4;
                const sc=calcHeatScore(data[idx],data[idx+1],data[idx+2]);
                if(sc>0){
                    heatPixels++;
                    totalHeat+=sc;
                    if(sc>maxHeat) maxHeat=sc;
                }
            }
        }
        const totalSampled=Math.ceil((w/step)*(h/step));
        const percent=totalSampled>0?Math.min(100,Math.floor((heatPixels/totalSampled)*100*1.6)):0;
        return {percent, maxHeat};
    }
    
    function findHotZones(imgData){
        const w=imgData.width, h=imgData.height, data=imgData.data;
        const mask=new Uint8Array(w*h);
        const step=3;
        for(let y=0;y<h;y+=step){
            for(let x=0;x<w;x+=step){
                const idx=(y*w+x)*4;
                const sc=calcHeatScore(data[idx],data[idx+1],data[idx+2]);
                if(sc>0){
                    for(let dy=0;dy<step && y+dy<h;dy++)
                        for(let dx=0;dx<step && x+dx<w;dx++)
                            mask[(y+dy)*w+(x+dx)]=1;
                }
            }
        }
        const boxes=[];
        const visited=new Uint8Array(w*h);
        const dirs=[[1,0],[-1,0],[0,1],[0,-1]];
        for(let y=0;y<h;y+=2){
            for(let x=0;x<w;x+=2){
                const idx=y*w+x;
                if(mask[idx] && !visited[idx]){
                    let minX=x,maxX=x,minY=y,maxY=y,cnt=0,q=[[x,y]];
                    visited[idx]=1;
                    while(q.length){
                        let [cx,cy]=q.shift();
                        const cid=cy*w+cx;
                        if(mask[cid]){
                            cnt++;
                            minX=Math.min(minX,cx);maxX=Math.max(maxX,cx);
                            minY=Math.min(minY,cy);maxY=Math.max(maxY,cy);
                            for(let [dx,dy] of dirs){
                                let nx=cx+dx, ny=cy+dy;
                                if(nx>=0 && nx<w && ny>=0 && ny<h && mask[ny*w+nx] && !visited[ny*w+nx]){
                                    visited[ny*w+nx]=1;
                                    q.push([nx,ny]);
                                }
                            }
                        }
                    }
                    if(cnt>18 && (maxX-minX)*(maxY-minY)>80){
                        boxes.push({x:minX,y:minY,w:maxX-minX+1,h:maxY-minY+1});
                    }
                }
            }
        }
        return boxes;
    }
    
    function calcRiskLevel(hotCount, heatPercent, maxHeat){
        let risk=Math.min(100, Math.floor(heatPercent*0.5 + hotCount*10 + (maxHeat?maxHeat*0.25:0)));
        risk=Math.min(100,risk);
        let level="", advice="";
        if(risk>75){ level="خطرناک 🔴"; advice="فوراً برق/گاز را قطع کن! کپسول آتش نشانی بکار."; }
        else if(risk>45){ level="هشدار 🟠"; advice="دستگاه داغ را خاموش کن. تهویه کن."; }
        else if(risk>18){ level="گرم 🟡"; advice="منبع گرما را خاموش کن."; }
        else { level="نرمال 🟢"; advice="وضعیت عادی."; }
        return {risk, level, advice};
    }
    
    function drawWithBoxes(ctx, imgElement, boxes, heatPercent){
        ctx.drawImage(imgElement,0,0,ctx.canvas.width,ctx.canvas.height);
        if(boxes.length){
            ctx.save();
            ctx.strokeStyle="#ff3300";
            ctx.fillStyle="rgba(255,50,0,0.25)";
            ctx.lineWidth=2;
            for(let b of boxes){
                ctx.strokeRect(b.x,b.y,b.w,b.h);
                ctx.fillRect(b.x,b.y,b.w,b.h);
            }
            ctx.restore();
        }
        ctx.font="11px monospace";
        ctx.fillStyle="#ffaa66";
        ctx.fillText(`🔥 ${heatPercent}%`,6,20);
    }
    
    async function sendFireAlert(riskPercent, camName, camId){
        const threshold = alertThreshold;
        if(riskPercent < threshold) return false;
        
        const lastSent = lastAlertSentForCam[camId];
        if(lastSent && lastSent >= threshold && riskPercent <= lastSent+5) return false;
        
        if(!botToken || !mainChatId){
            addLog(`⚠️ هشدار شناسایی شد ولی اطلاعات تلگرام موجود نیست`, true);
            return false;
        }
        
        const time = new Date().toLocaleString('fa-IR');
        let alertIcon = "";
        if(riskPercent >= 75) alertIcon = "🔴🚨 خطر بسیار بالا - آتش سوزی محتمل!";
        else if(riskPercent >= 60) alertIcon = "🟠⚠️ هشدار جدی - گرمای شدید!";
        else alertIcon = "🟡 هشدار - افزایش دما";
        
        const message = `🔥 <b>اعلام حریق</b> 🔥\n\n${alertIcon}\n📍 <b>دوربین:</b> ${camName}\n🔥 <b>درصد خطر:</b> ${riskPercent}%\n⏰ <b>زمان:</b> ${time}\n\n⚠️ <b>اقدام فوری:</b> منبع حرارت را قطع کنید.`;
        
        addLog(`🚨 هشدار! خطر ${riskPercent}% در ${camName} - ارسال پیام...`);
        const sent = await sendToAllRecipients(message);
        
        if(sent > 0){
            lastAlertSentForCam[camId] = riskPercent;
            return true;
        }
        return false;
    }
    
    function startCameraLoop(cam){
        if(cam.animId) cancelAnimationFrame(cam.animId);
        function loop(){
            if(!cam.active || !cam.img || !cam.img.complete || cam.img.naturalWidth===0){
                if(cam.active) cam.animId=requestAnimationFrame(loop);
                else cam.animId=null;
                return;
            }
            const w=cam.img.naturalWidth, h=cam.img.naturalHeight;
            if(cam.canvas.width!==w || cam.canvas.height!==h){
                cam.canvas.width=w;
                cam.canvas.height=h;
            }
            const ctx=cam.canvas.getContext('2d');
            ctx.drawImage(cam.img,0,0,w,h);
            
            if(!cam.skip) cam.skip=0;
            cam.skip++;
            if(cam.skip>=2){
                cam.skip=0;
                let imgData=null;
                try{ imgData=ctx.getImageData(0,0,w,h); }catch(e){ cam.animId=requestAnimationFrame(loop); return; }
                
                const heatRes=analyzeHeat(imgData);
                const boxes=findHotZones(imgData);
                const riskRes=calcRiskLevel(boxes.length, heatRes.percent, heatRes.maxHeat);
                
                cam.hotZones=boxes;
                cam.heatPercent=heatRes.percent;
                cam.riskData=riskRes;
                
                const riskSpan=document.getElementById(`risk_${cam.id}`);
                const heatSpan=document.getElementById(`heat_${cam.id}`);
                const zoneSpan=document.getElementById(`zone_${cam.id}`);
                const riskBadge=document.getElementById(`badge_${cam.id}`);
                const adviceSpan=document.getElementById(`advice_${cam.id}`);
                if(riskSpan) riskSpan.innerText=riskRes.risk+"%";
                if(heatSpan) heatSpan.innerText=heatRes.percent+"%";
                if(zoneSpan) zoneSpan.innerText=boxes.length;
                if(adviceSpan) adviceSpan.innerText=riskRes.advice.substring(0,50);
                if(riskBadge){
                    riskBadge.className=`badge-risk ${riskRes.risk>75?'risk-high':(riskRes.risk>45?'risk-med':'risk-low')}`;
                    riskBadge.innerText=riskRes.level.split(' ')[0];
                }
                drawWithBoxes(ctx, cam.img, boxes, heatRes.percent);
                
                if(riskRes.risk >= alertThreshold){
                    sendFireAlert(riskRes.risk, `دوربین ${cam.id}`, cam.id);
                }
            }else{
                if(cam.hotZones && cam.hotZones.length>0){
                    drawWithBoxes(ctx, cam.img, cam.hotZones, cam.heatPercent||0);
                }
            }
            cam.animId=requestAnimationFrame(loop);
        }
        cam.animId=requestAnimationFrame(loop);
    }
    
    function stopCamera(cam){
        cam.active=false;
        if(cam.animId){ cancelAnimationFrame(cam.animId); cam.animId=null; }
        if(cam.img){
            cam.img.onload=null;
            cam.img.onerror=null;
            cam.img.src='';
            cam.img=null;
        }
        if(cam.canvas){
            const ctx=cam.canvas.getContext('2d');
            ctx.fillStyle="#0a0c14";
            ctx.fillRect(0,0,cam.canvas.width,cam.canvas.height);
            ctx.fillStyle="#94a3b8";
            ctx.font="14px";
            ctx.fillText("⛔ متوقف شده",cam.canvas.width/2-50,cam.canvas.height/2);
        }
    }
    
    function removeCamera(camId){
        const idx=cameras.findIndex(c=>c.id===camId);
        if(idx===-1) return;
        const cam=cameras[idx];
        stopCamera(cam);
        const card=document.getElementById(`cam_${camId}`);
        if(card) card.remove();
        cameras.splice(idx,1);
        updateTotalCount();
        delete lastAlertSentForCam[camId];
    }
    
    function addCamera(ipUrl){
        let url=ipUrl.trim();
        if(!url.startsWith('http')) url='http://'+url;
        if(!url.includes('/video') && !url.includes('.mjpg') && !url.includes('/mjpeg')){
            if(!url.endsWith('/')) url+='/';
            url+='video';
        }
        const id=nextId++;
        const card=document.createElement('div');
        card.className='cam-card';
        card.id=`cam_${id}`;
        card.innerHTML=`
            <div class="cam-header">
                <span class="cam-name">📹 دوربین ${id}</span>
                <div class="cam-stats">
                    <span class="badge-risk risk-low" id="badge_${id}">نرمال</span>
                    <span class="remove-cam" data-id="${id}">✖ حذف</span>
                </div>
            </div>
            <div class="video-area">
                <canvas id="can_${id}" width="400" height="260" style="width:100%;height:auto;background:#000;"></canvas>
            </div>
            <div class="cam-footer">
                <span>🔥 <span id="risk_${id}">0</span>%</span>
                <span>🌡️ <span id="heat_${id}">0</span>%</span>
                <span>📍 <span id="zone_${id}">0</span></span>
                <span id="advice_${id}" style="font-size:0.65rem;">...</span>
            </div>
        `;
        gridEl.appendChild(card);
        const canvas=document.getElementById(`can_${id}`);
        const img=new Image();
        img.crossOrigin="Anonymous";
        const camObj={
            id, img, canvas, animId:null, active:true,
            hotZones:[], heatPercent:0, riskData:{risk:0,level:'',advice:''}, skip:0
        };
        cameras.push(camObj);
        img.onload=()=>{ if(camObj.active) startCameraLoop(camObj); addLog(`دوربین ${id} متصل شد`); };
        img.onerror=()=>{
            const ctx=canvas.getContext('2d');
            ctx.fillStyle="#0a0c14";
            ctx.fillRect(0,0,canvas.width,canvas.height);
            ctx.fillStyle="#ef4444";
            ctx.font="12px";
            ctx.fillText("❌ خطا",canvas.width/2-30,canvas.height/2);
            addLog(`دوربین ${id} اتصال ناموفق`, true);
        };
        img.src=url;
        camObj.img=img;
        card.querySelector('.remove-cam').onclick=()=> removeCamera(id);
        updateTotalCount();
    }
    
    function updateTotalCount(){
        totalSpan.innerText=cameras.length+" دوربین";
    }
    
    function stopAllCameras(){
        for(let cam of cameras) stopCamera(cam);
        cameras=[];
        gridEl.innerHTML='';
        updateTotalCount();
        lastAlertSentForCam={};
        addLog("همه دوربین‌ها متوقف شدند");
    }
    
    addBtn.onclick=()=>{
        let val=newIpInput.value.trim();
        if(val) addCamera(val);
        else alert("آدرس دوربین را وارد کنید");
        newIpInput.value='';
    };
    addDefaultBtn.onclick=()=> addCamera("http://192.168.1.3:8080/video");
    stopAllBtn.onclick=()=>{ if(confirm("همه دوربین‌ها متوقف شوند؟")) stopAllCameras(); };
    
    if(isUserConfigured()){
        loadUserData();
        setupModal.style.display = 'none';
        mainApp.style.display = 'block';
        updateTelegramStatus();
        addLog("✅ خوش آمدید! سیستم بارگذاری شد");
        setTimeout(()=> addCamera("http://192.168.1.3:8080/video"), 500);
    } else {
        setupModal.style.display = 'flex';
        mainApp.style.display = 'none';
    }
    
    saveSetupBtn.onclick = saveInitialSetup;
})();