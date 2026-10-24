import {customerKey,toRecord,fromRecord} from './customer-model.mjs';
const SDK='https://www.gstatic.com/firebasejs/12.4.0/';
export async function createCloudStore(config,testing=null){
  if(testing&&!config.projectId.startsWith('demo-'))throw Error('本机测试只能使用虚构项目。');
  const [appApi,authApi,f]=testing?.sdk||await Promise.all([import(SDK+'firebase-app.js'),import(SDK+'firebase-auth.js'),import(SDK+'firebase-firestore.js')]);
  const app=appApi.initializeApp(config,testing?.name),auth=authApi.getAuth(app);
  const db=f.initializeFirestore(app,{localCache:f.memoryLocalCache()});
  if(testing){authApi.connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});f.connectFirestoreEmulator(db,'127.0.0.1',8080)}
  await authApi.setPersistence(auth,authApi.browserLocalPersistence);
  let actor=null,generation=0,unsubscribe=()=>{};
  function requireActor(){if(!actor||!auth.currentUser||auth.currentUser.uid!==actor.uid)throw Error('请先登录已启用的员工账号。');return {...actor,generation}}
  function stillCurrent(a){if(a.generation!==generation)throw Error('登录状态已变化，请重新操作。')}
  const customerRef=id=>f.doc(db,'customers',id);
  function filters(options={},a=requireActor()){
    const terms=[f.where('deleted','==',!!options.deleted)];
    const owner=a.role==='ADMIN'?options.ownerUid:a.uid;
    if(owner)terms.push(f.where('ownerUid','==',owner));
    if(options.search)terms.push(f.where('searchTerms','array-contains',options.search.trim().toLowerCase()));
    if(options.min!==undefined&&options.min!=='')terms.push(f.where('composite','>=',Number(options.min)));
    if(options.max!==undefined&&options.max!=='')terms.push(f.where('composite','<=',Number(options.max)));
    return terms;
  }
  return {
    watch(callback){return authApi.onAuthStateChanged(auth,user=>{
      generation++;actor=null;unsubscribe();callback(null);
      if(!user)return;
      const token=generation;
      unsubscribe=f.onSnapshot(f.doc(db,'staff',user.uid),{includeMetadataChanges:true},snap=>{
        if(token!==generation)return;
        // Never authorize a cached whitelist entry while offline.
        if(snap.metadata.fromCache)return;
        const data=snap.data();
        if(data?.enabled!==true||!['ADMIN','EMPLOYEE'].includes(data.role)){actor=null;callback(null,Error('账号尚未获授权或已停用，请联系管理员。'));return}
        actor={...data,uid:user.uid,email:user.email};callback(actor);
      },()=>{if(token===generation){actor=null;callback(null,Error('无法确认员工权限，请联网后重新登录。'))}});
    })},
    login:(email,password)=>authApi.signInWithEmailAndPassword(auth,email,password),
    resetPassword:email=>authApi.sendPasswordResetEmail(auth,email),
    logout:async()=>{generation++;actor=null;unsubscribe();await authApi.signOut(auth)},
    async list(options={},cursor=null){
      const a=requireActor(),terms=filters(options,a);
      terms.push(f.orderBy(options.sort==='date'?'updatedAt':'composite','desc'));
      if(options.sort==='date'&&((options.min!==undefined&&options.min!=='')||(options.max!==undefined&&options.max!=='')))terms.push(f.orderBy('composite','asc'));
      terms.push(f.orderBy(f.documentId()));
      if(cursor)terms.push(f.startAfter(cursor));terms.push(f.limit(50));
      const snap=await f.getDocsFromServer(f.query(f.collection(db,'customers'),...terms));stillCurrent(a);
      return {clients:snap.docs.map(fromRecord),cursor:snap.docs.at(-1),hasMore:snap.size===50};
    },
    async save(client,source,{expectedRevision=null}={}){
      const a=requireActor(),owner=client.id?client.ownerUid:a.uid;
      const id=client.id||await customerKey(owner,source,String(client.answers.customerId||''));
      const ref=customerRef(id),record=toRecord(client,owner,source);
      await f.runTransaction(db,async transaction=>{
        stillCurrent(a);
        const existing=await transaction.get(ref),current=existing.data();
        if(existing.exists()){
          const expected=client.id?client.revision:expectedRevision;
          if(expected===null){const error=Error('发现同一来源和编号的客户。');error.code='duplicate';error.existing=fromRecord(existing);throw error}
          if(current.revision!==expected){const error=Error('这条客户已被其他操作更新，请重新加载详情后再修改。');error.code='conflict';throw error}
          if(current.ownerUid!==owner||current.source!==source||current.answerId!==record.answerId)throw Error('客户归属、问卷来源及答卷编号不能修改。');
        }
        transaction.set(ref,{...record,createdAt:current?.createdAt||f.serverTimestamp(),updatedAt:f.serverTimestamp(),updatedBy:a.uid,revision:(current?.revision||0)+1});
      });
      stillCurrent(a);
      // The transaction has been acknowledged. A subsequent read supplies server timestamps.
      const snap=await f.getDocFromServer(ref);stillCurrent(a);return fromRecord(snap);
    },
    async employees(cursor=null){
      const a=requireActor();const terms=[f.orderBy(f.documentId()),f.limit(50)];if(cursor)terms.push(f.startAfter(cursor));
      const snap=await f.getDocsFromServer(f.query(f.collection(db,'staff'),...terms));stillCurrent(a);
      return {items:snap.docs.map(d=>({uid:d.id,...d.data()})),cursor:snap.docs.at(-1),hasMore:snap.size===50};
    },
    async statistics(uid){
      const a=requireActor(),q=f.query(f.collection(db,'customers'),f.where('ownerUid','==',uid),f.where('deleted','==',false));
      const values=await f.getAggregateFromServer(q,{count:f.count(),H:f.average('result.scores.H'),S:f.average('result.scores.S'),A:f.average('result.scores.A'),C:f.average('composite')});
      const recent=await f.getDocsFromServer(f.query(q,f.orderBy('updatedAt','desc'),f.orderBy(f.documentId()),f.limit(1)));stillCurrent(a);
      return {...values.data(),latest:recent.docs[0]?.data().updatedAt};
    },
  };
}
