importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js','https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
firebase.initializeApp({apiKey:"AIzaSyCi2wrQeSf6DwIgG4CmE7b5wcaHK-yVgY8",authDomain:"hub-famille-3c14f.firebaseapp.com",projectId:"hub-famille-3c14f",storageBucket:"hub-famille-3c14f.firebasestorage.app",messagingSenderId:"252415227259",appId:"1:252415227259:web:082abd520d943faf77b9de"});
const messaging=firebase.messaging();
messaging.onBackgroundMessage(p=>{const d=p.data||{};self.registration.showNotification(d.title||"Tiki's App",{body:d.body||'',tag:d.tag||undefined,icon:'icon-192.png',badge:'icon-192.png'})});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(l=>{for(const c of l){if('focus'in c)return c.focus()}return clients.openWindow(self.registration.scope)}))});
