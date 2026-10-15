import ts from 'typescript';
import { scanPublicText } from './public-repo-rules.mjs';
/** Minified expressions such as `condition ? value : /regex/` are not drive paths. */
export function scanJavaScript(text) {
  const source=ts.createSourceFile('bundle.js',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),findings=[],comments=new Set();
  function visit(node){
    if(ts.isStringLiteralLike(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node)){findings.push(...scanPublicText(node.text));}
    for(const range of [...(ts.getLeadingCommentRanges(text,node.pos)??[]),...(ts.getTrailingCommentRanges(text,node.end)??[])]){const key=range.pos+':'+range.end;if(!comments.has(key)){comments.add(key);findings.push(...scanPublicText(text.slice(range.pos,range.end)));}}
    ts.forEachChild(node,visit);
  } visit(source); if(source.parseDiagnostics.length){throw new Error('Generated JavaScript could not be parsed for public-data scanning.');}return findings;
}
