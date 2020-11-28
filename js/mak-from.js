async function hitDatabase(queries){   
    const r= await fetch("https://brfenergi.se/task-planner/MakumbaQueryServlet", {
	method: "POST",
	credentials: "include",
	body:
	"request=" +
	    encodeURIComponent(JSON.stringify({ queries})) +
	    "&analyzeOnly=false"
    });
    if(!r.ok)
	throw JSON.stringify(await r.json());
    return await r.json();
}

let queryState={
    cleanup(){
	this.queryFinder={};
	this.queries=[];
	this.parent=-1;
	this.dirty=null;
	this.queryDiscovery=null;
	this.queryDirty=null;
	this.data=null;
    },
    
    findQuery(q){
	const {queryState, loading, ...props}=q;
	const key=JSON.stringify(props);
	const ret= this.queryFinder[key];
	if(ret)
	    return ret;
	this.queryDirty=true;
	this.queries.push({
            projections: [],
            querySections: [q.from,  q.where, q.groupBy, q.orderBy, null, null, null],
            parentIndex: this.parent,
            limit: -1,
            offset: 0
	});
	return this.queryFinder[key]=this.queries.length-1;
    },
    collectProjections(proj, queryIndex){
	if (!this.queries[queryIndex].projections.includes(proj)) {
            this.queries[queryIndex].projections.push(proj);
	    this.dirty=true;
	}
    },
};
queryState.cleanup();

function from(from){
    return new Query({from});
}

class Query{
    constructor(props){
	Object.assign(this, props);
	this.loading=()=>"";
    }

    where(where){ return new Query({...this, where});}
    orderBy(orderBy){ return new Query({...this, orderBy});}
    groupBy(groupBy){ return new Query({...this, groupBy});}
    loading(loading){ return new Query({...this, loading});}

    map(func, qs=queryState){
	this.parent=qs.parent;
	let queryIndex= qs.findQuery(this);
	
	if(!queryIndex)
	    return this.rootMap(func, qs);
	else 
	    return this.childMap(func, qs, queryIndex);
    }
    
    rootMap(func, qs){
	qs.queryDiscovery=true;
	this.dryRun(func, qs, 0);
	qs.queryDiscovery=false;
	this.queryState=Object.assign({},qs);

	// leave a clean state after analysis
	qs.cleanup();
	
	const refresh=()=>{
	    return this.runQueries(func);
	};
	const prms=refresh();

	prms.refresh= ()=> refresh();
	prms.toReact=()=>toReact(prms, this.loading);
	prms.toVue=()=>toVue(prms, this.loading);
	let ret= prms;
	try{
	    Vue;
	    ret=prms.toVue();
	}catch(e){}
	try{
	    ReactDOM;
	    ret=Object.assign({},prms.toReact());
	}catch(e){}
	if(ret!=prms){
	    ret.then= prms.then.bind(prms);
	    ret.catch= prms.catch.bind(prms);
	}
        return ret;
    }

    async runQueries(func){
        let result;
        do{
	    this.queryState.dirty=false;
	    this.queryState.queryDirty=false;
	    this.queryState.data= (await hitDatabase(this.queryState.queries)).resultData;
	    // promise is fulfilled, we iterate to completion
	    queryState=this.queryState;
	    result= this.iterate(func, queryState, 0);
	}while(this.queryState.dirty || this.queryState.queryDirty);
	// leave a clean state after data iteration
	queryState=Object.assign({},this.queryState);
	queryState.cleanup();
	return result;
    }

    iterate(func, qs, queryIndex){
	const dt=qs.data;
	try{
	    return dt[queryIndex].map(function(d, i, arr){
		qs.data=d;
		qs.parent=queryIndex;
		Mak.expr=function(proj){
		    // TODO: dirty
		    return d[proj];
		};
		return func(Mak.expr, i, arr);	      
	    });
	}finally{
	    qs.data=dt;
	    qs.parent=this.parent;
	    Mak.expr=null;
	}
    }
    dryRun(func, qs, queryIndex){
	qs.parent=queryIndex;
	try{
	    Mak.expr= function(proj){ return qs.collectProjections(proj, queryIndex);};
	    func(Mak.expr, -1, []);
	}finally{ qs.parent=this.parent;}
    }
    childMap(func, qs, queryIndex){
	if(qs.queryDiscovery){
	    this.dryRun(func, qs, queryIndex);
	    return [];
	}
	else return this.iterate(func, qs, queryIndex);
    }
    
}

const Mak={
    addObserver(o){ this.subscribers= this.subscribers?[...this.subscribers, o]:[o]; return ()=>this.removeObserver(o); },
    removeObserver(o){ this.subscribers= this.subscribers.filter(x=>x!=o);},
    sync(){ this.subscribers && this.subscribers.forEach(o=>o());}
};

function RenderPromiseReact({promise, loading}){
    const [data, setData]=React.useState();
    const [error, setError]=React.useState();
    React.useEffect(()=> {promise.then(d=> setData(d)).catch(e=>setError(e));}, []);
    React.useEffect(()=> Mak.addObserver(()=> promise.refresh().then(d=> setData(d)).catch(e=>setError(e))), []);
    
    return error || data || loading();
}

const RenderPromiseVue={
    props:["promise", "loading"],
    data(){
	return { data:null, error:null};
    },
    created(){
	this.promise.then(d=>this.data=d).catch(e=>this.error=e);
	this.unsubscribe=Mak.addObserver(()=> this.promise.refresh().then(d=> this.data=d).catch(e=>this.error=e));
    },
    render(){
	return this.error || this.data || this.loading();
    },
    unmounted(){
	this.unsubscribe();
    }
};

function toReact(promise, loading){
    return React.createElement(RenderPromiseReact, {promise, loading});
}
function toVue(promise, loading){
    return Vue.h(RenderPromiseVue, {promise, loading});
}
