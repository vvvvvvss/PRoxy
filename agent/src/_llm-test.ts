import { rankIssues } from "./agent.js";
console.log(JSON.stringify(await rankIssues([{number:1,title:"Fix typos",body:"",labels:[]}])));
process.exit(0);
