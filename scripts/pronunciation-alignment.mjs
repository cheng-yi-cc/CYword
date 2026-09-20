// 离线候选生成器。候选必须逐词复核后才能写入正式增强数据。
export function normalizeIpa(source) {
  return source.replace(/^\/|\/$/g, "").replaceAll("'", "ˈ").replaceAll(",", "ˌ")
    .replaceAll(":", "ː").replaceAll("g", "ɡ").replaceAll("ε", "ɛ")
    .replaceAll("ai", "aɪ").replaceAll("au", "aʊ").replaceAll("ei", "eɪ")
    .replaceAll("əu", "əʊ").replaceAll("oi", "ɔɪ").replaceAll(" ", "").replaceAll(".", "");
}

const rules = [];
function add(letters, sounds, cost = 0) {
  for (const g of letters.split(" ")) for (const p of sounds.split(" ")) rules.push({g, p, cost});
}
for (const [g,p] of Object.entries({b:"b",c:"k s",d:"d",f:"f",g:"ɡ dʒ",h:"h",j:"dʒ",k:"k",l:"l",m:"m",n:"n",p:"p",q:"k",r:"r (r)",s:"s z",t:"t",v:"v",w:"w",x:"ks",y:"j",z:"z"})) add(g,p);
add("a", "æ ə eɪ ɑː ɑ ɔː ɒ ɛ e", .15);
add("e", "e ɛ ə ɪ i iː", .15);
add("i", "ɪ i iː aɪ ə", .15);
add("o", "ɒ ɑ ɑː ɔː ɔ əʊ oʊ o ʌ ə", .15);
add("u", "ʌ ʊ u uː ju juː ə ɪ", .15);
add("y", "ɪ i iː aɪ ə", .15);
add("a", "ɪ ɔ", 1); add("e", "eɪ", 1); add("o", "ʊ uː u", 1); add("u", "e ɛ", 2);
add("ai ay", "eɪ", -.1); add("au aw", "ɔː ɔ ɑː ɑ", -.1);
add("ea", "iː i e ɛ eɪ", -.1); add("ee", "iː i", -.1);
add("ei ey", "eɪ iː i", -.1); add("ie", "iː i aɪ", -.1);
add("oa oe", "əʊ oʊ", -.1); add("oi oy", "ɔɪ", -.1);
add("oo", "uː u ʊ ʌ", -.1); add("ou", "aʊ ʌ əʊ oʊ uː u ʊ ə", -.1);
add("ow", "aʊ əʊ oʊ", -.1); add("ue ui", "uː u juː ju", -.1);
add("ew", "juː uː ju u", -.1);
add("ar", "ɑː ɑ ə ɜː ɚ ɝ", -.1); add("er ir ur", "ɜː ɜ ɝ ɚ ə", -.1);
add("or", "ɔː ɔ ə ɜː ɝ ɚ", -.1); add("our", "ɔː ɔ ɜː ə ɝ ɚ", -.1);
add("air are ear ere", "eə ɛə er ɛr", -.1); add("ear eer ere", "ɪə ɪr", -.1);
add("ear", "ɜː ɝ ɚ", -.1); add("ure our", "ʊə ʊr", -.1);
add("ch tch", "tʃ", -.15); add("ch", "k ʃ", .1); add("sh", "ʃ", -.15);
add("th", "θ ð", -.15); add("ph", "f", -.15); add("ng", "ŋ", -.1); add("n", "ŋ", .05);
add("ck", "k", -.15); add("qu", "kw", -.1); add("wh", "w", -.1); add("wh", "h", .3);
add("t", "ʃ tʃ", .4); add("s", "ʃ ʒ", .4); add("c", "ʃ", .4); add("d", "dʒ", .4);
add("x", "ɡz z kʃ", .3); add("sc", "s", .2); add("gn", "n", .2); add("wr", "r", .2);
add("kn", "n", .2); add("rh", "r", .2); add("gh", "f ɡ", .3); add("dg dge", "dʒ", -.1);
add("ti ci si ssi", "ʃ", -.2); add("si", "ʒ", -.2); add("ci", "tʃ", .2);
add("tu", "tʃuː tʃə", .6); add("su", "ʒuː ʒə ʃʊ ʃuː", .6);
add("al el le il ol ul", "l", -.2); add("en on an ain", "n", -.2); add("em om", "m", .5);
add("e", "", .05); add("r", "", .5); add("h", "", 1);
add("w b k g t l n p s u i a o c d", "", 3);
add("gh", "", .5);
add("igh", "aɪ", -.1); add("eigh", "eɪ", -.1); add("augh ough", "ɔː", 0);
add("ough", "əʊ oʊ uː ʌf ɒf aʊ", .1);
add("u", "jə jʊ jʊə ʊə", .1); add("i", "j", .3);
add("e", "ɪə eə", .35); add("a", "eə", .35);
add("i y", "aɪə", .4); add("ou ow", "aʊə", .3);
add("e a", "a", 2); add("e", "əː", 2);
add("a", "aɪ", 2); add("au", "aʊ", 1);
add("ti", "tʃ", -.2); add("c", "z", 1); add("s", "ʒ", .3);
add("m", "əm", .3); add("th", "t", 1); add("d", "t", 1);
add("ng", "ŋɡ ŋk", -.05); add("gu", "ɡw", -.1);
add("ui", "wiː wɪ", .3); add("u", "w", .3);
add("ch", "", 1); add("g", "ʒ", .3); add("dj", "dʒ", -.2);
add("ss", "ʃ", -.1); add("oir oire", "wɑː wɑːr", -.2);
add("eo", "iː", -.1); add("eo", "e", .4);
add("ire yre", "aɪə aɪər aɪə(r)", -.15);
// 词书同时使用非卷舌、卷舌及可选 r，三者按原文分别对齐。
for (const rule of [...rules]) {
  if (/r/.test(rule.g) && !/[r)]/.test(rule.p) && /[əɜɔɑɪɛeʊɝɚ]/.test(rule.p)) {
    rules.push({...rule,p:rule.p+"r"},{...rule,p:rule.p+"(r)"});
  }
  if (rule.p.includes("ə")) rules.push({...rule,p:rule.p.replaceAll("ə","(ə)")});
}
add("eo", "ɪə(ʊ)", .1);
add("ai", "aɪ", .1); add("u", "ɔː", .5); add("ea", "ɛ", .1);
add("e", "i", .2); add("eur", "ɜː ɜːr ɜː(r)", -.1);
add("x", "ɡ", .3); add("s", "sə", .6); add("g", "ʒɑː", .5);
add("z", "ts", .1); add("ti", "ʒ", -.1);
add("choir", "kwaɪə(r)", 0); add("colonel", "kɜːrnl", 0);
add("re", "rə kə(r)", 1); add("ar", "ɑ", .1); add("er", "ɑː", 1);
add("ur", "ə", .1); add("le", "(ə)l", .1); add("a", "(ə)", .1);
add("re", "ə(r)", .1); add("eau", "ə", .1);
add("ea", "ɛr", -.1); add("i", "i", .2); add("eu", "ɜː ɜːr", .1);
add("u", "ʊr", .2); add("a", "ər", .5); add("yr", "ɚ", .1);
add("que", "keɪ", .1);
add("le", "əl", .1); add("e", "ɒ ɑː", .5); add("x", "ɡʒ", .1);
add("oor", "ʊə ʊə(r) ʊər ɔː ɔːr", -.2);
add("sch", "ʃ", -.2); add("x", "k", .1);
add("sci sc", "ʃ", -.2); add("gi", "dʒ", -.2);
add("gu", "ɡ", -.1); add("qu", "k", -.1);
add("oa", "o", -.1); add("ow", "o", -.1); add("ei", "e ɛ", -.1);
add("ui", "ɪ", -.1); add("our", "ɑː ɑː(r)", -.1);
add("oar", "ɔː ɔːr ɔː(r)", -.1); add("oor", "ɔː(r)", -.1);
add("ia", "ɪ ə", .1); add("au", "ə", .1); add("ai", "ə ɪ e", .1);
add("ieu", "uː", -.1); add("eue", "juː", -.1); add("gue", "ɡ", -.1);
add("ge", "ʒɑː", -.1);
add("ge", "dʒ", -.1); add("ure", "jʊə jʊə(r) jʊər", -.1);
add("ism", "ɪzəm ɪz(ə)m", -.2);
add("eau", "əʊ oʊ o", -.1); add("ei", "eə eə(r)", -.1);
add("weird", "wɪəd", 0); add("eir", "eə eə(r)", -.1);
add("ay", "eə eə(r)", -.1);
add("ia io", "ɪə", .1); add("ya", "eə", .2);
add("iu", "ɪə", .1);
// 双写辅音只发一个辅音；保留整体映射以免制造“两个辅音都发音”的假象。
for (const g of "bcdfgklmnprstz") {
  for (const r of rules.filter(r=>r.g===g && r.p)) rules.push({g:g+g,p:r.p,cost:r.cost-.12});
}
const byInitial = new Map();
for (const rule of rules) {
  if (!byInitial.has(rule.g[0])) byInitial.set(rule.g[0], []);
  byInitial.get(rule.g[0]).push(rule);
}

export function align(spelling, ipa) {
  const word=spelling.toLowerCase();
  const sound=ipa.replace(/[ˈˌ]/g, "");
  const forbidden=new Set();
  for(const match of sound.matchAll(/eɪ|aɪ|aʊ|ɔɪ|əʊ|oʊ|ɪə|eə|ʊə/g)) forbidden.add(match.index+1);
  const memo=new Map();
  function solve(i,j) {
    if (i===word.length && j===sound.length) return {cost:0, pieces:[]};
    const key=i+":"+j;
    if(memo.has(key)) return memo.get(key);
    let best=null;
    const choices = [...(byInitial.get(word[i])||[])];
    if(word[i]==="-") choices.push({g:"-",p:"",cost:0});
    for(const rule of choices) {
      if(!word.startsWith(rule.g,i)||!sound.startsWith(rule.p,j)) continue;
      if(forbidden.has(j+rule.p.length)) continue;
      if(/^[lmn]$/.test(rule.p) && /[aeiou]/.test(rule.g) && /[æɑɒɔeɛəɜɝɚɪiʊuʌaoː]$/.test(sound.slice(0,j))) continue;
      const next=solve(i+rule.g.length,j+rule.p.length);
      if(!next) continue;
      const cost=rule.cost+next.cost+.01;
      if(!best||cost<best.cost) best={cost,pieces:[{text:spelling.slice(i,i+rule.g.length),ipa:rule.p,start:i,end:i+rule.g.length,phoneStart:j,phoneEnd:j+rule.p.length},...next.pieces]};
    }
    memo.set(key,best);
    return best;
  }
  return solve(0,0);
}

const vowel=/[æɑɒɔeɛəɜɝɚɪiʊuʌao]/;
const shortVowel=/^(?:æ|e|ɛ|ɪ|ɒ|ʌ|ʊ)$/;
const onsets=new Set(["", "b","d","f","ɡ","h","j","k","l","m","n","p","r","s","t","v","w","z","ʃ","ʒ","θ","ð","tʃ","dʒ","pl","pr","bl","br","tr","dr","kl","kr","ɡl","ɡr","fl","fr","θr","ʃr","sl","sm","sn","sp","st","sk","sw","tw","kw","dw","spl","spr","str","skr","skw","mj","nj","pj","bj","fj","vj","kj","ɡj","hj","sj","stj","θj","lj","tj","dj"]);
export function chunkAlignment(alignment, ipa) {
  const parts=alignment.pieces;
  const nuclei=[];
  for(let i=0;i<parts.length;i++) {
    const previous=parts.slice(0,i).findLast(p=>p.ipa)?.ipa??"";
    const next=parts.slice(i+1).find(p=>p.ipa)?.ipa??"";
    const syllabic=/^[lmn]$/.test(parts[i].ipa)&&/[aeiou]/i.test(parts[i].text)
      && !vowel.test(previous) && !vowel.test(next);
    if(vowel.test(parts[i].ipa)||syllabic) nuclei.push(i);
  }
  const stress=[]; let cursor=0;
  for(const c of ipa) { if(c==="ˈ"||c==="ˌ") stress.push({at:cursor,level:c==="ˈ"?"primary":"secondary"}); else cursor++; }
  const boundaries=[0];
  for(let n=1;n<nuclei.length;n++) {
    const prev=nuclei[n-1], curr=nuclei[n];
    let boundary=curr;
    for(let b=prev+1;b<=curr;b++) {
      const onset=parts.slice(b,curr).map(p=>p.ipa).join("");
      if(onsets.has(onset)) { boundary=b; break; }
    }
    const mark=stress.find(s=>s.at>parts[prev].phoneStart && s.at<=parts[curr].phoneStart);
    if(mark) {
      const exact=parts.findIndex((p,i)=>i>prev && i<=curr && p.phoneStart===mark.at && p.ipa);
      if(exact>=0) boundary=exact;
    } else if(shortVowel.test(parts[prev].ipa) && vowel.test(parts[curr].ipa) && boundary===prev+1 && curr>prev+1 && !/^(.)\1$/i.test(parts[boundary].text) && !/^(?:ti|ci|si|ssi|sci)$/i.test(parts[boundary].text)) {
      // 闭音节中的短元音优先带上后续辅音，形成便于记忆的拼写块。
      boundary++;
    }
    while(boundary<curr && !parts[boundary].ipa) boundary++;
    boundaries.push(boundary);
  }
  boundaries.push(parts.length);
  const chunks=boundaries.slice(0,-1).map((start,i)=>{
    const slice=parts.slice(start,boundaries[i+1]);
    const nucleus=nuclei[i];
    const previous=nucleus===undefined?-1:(i===0?-1:parts[nuclei[i-1]].phoneStart);
    const mark=nucleus===undefined?undefined:stress.find(s=>s.at>previous && s.at<=parts[nucleus].phoneStart);
    return {text:slice.map(p=>p.text).join(""),ipa:slice.map(p=>p.ipa).join(""),stress:mark?.level??"none"};
  });
  // 双写字母分置两侧，整体仍只对应一个辅音；避免 a·ccount 这样的标题。
  for(let i=1;i<chunks.length;i++) {
    const match=chunks[i].text.match(/^([bcdfgklmnprstz])\1/i);
    if(match) {chunks[i-1].text+=chunks[i].text[0];chunks[i].text=chunks[i].text.slice(1);}
  }
  return chunks;
}
