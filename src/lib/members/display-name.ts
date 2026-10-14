export type NamedMember = {id:string;name:string};
// Stable identity links current profile names to historical attribution.
// Keep the saved name when a former member is absent from the active directory.
export function displayMemberName(id:string|null|undefined,savedName:string|null|undefined,members:readonly NamedMember[]):string|null {
  return (id?members.find(member=>member.id===id)?.name:undefined)??savedName??null;
}
