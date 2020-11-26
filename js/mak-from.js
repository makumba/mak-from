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
	throw await r.json();
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
	const {queryState, ...props}=q;
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
    }

    where(where){ return new Query({...this, where});}
    orderBy(orderBy){ return new Query({...this, orderBy});}
    groupBy(groupBy){ return new Query({...this, groupBy});}

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
	qs.cleanup();
	const prms= this.runQueries(func);

	prms.toReact=()=>toReact(prms);
	prms.toVue=()=>toVue(prms);
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
	this.queryState.cleanup();
	return result;
    }

    iterate(func, qs, queryIndex){
	const dt=qs.data;
	try{
	    return qs.data[queryIndex].map(function(d){
		qs.data=d;
		qs.parent=queryIndex;
		return func(function(proj){
		    // TODO: dirty
		    return d[proj];
		});
	    });
	}finally{
	    qs.data=dt;
	    qs.parent=this.parent;
	}
    }
    dryRun(func, qs, queryIndex){
	qs.parent=queryIndex;
	try{
	    func(proj=>qs.collectProjections(proj, queryIndex), -1, []);
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

function RenderPromiseReact({promise}){
    const [data, setData]=React.useState();
    const [error, setError]=React.useState();
    React.useEffect(()=> {promise.then(d=> setData(d)).catch(e=>setError(e));});
    
    return error && JSON.stringify(error) || data || "loading";
}

const RenderPromiseVue={
    props:["promise"],
    data(){
	return { data:null, error:null};
    },
    created(){
	this.promise.then(d=>this.data=d).catch(e=>this.error=e);
    },
    render(){
	return this.error && JSON.stringify(this.error) || this.data || "loading";	
    }
};

function toReact(promise){
    return React.createElement(RenderPromiseReact, {promise});
}
function toVue(promise){
    return Vue.h(RenderPromiseVue, {promise});
}