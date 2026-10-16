const COLORS:Record<string,string>={"Sunday Service":"#a56d32","Healing Meeting":"#4f7c60","Revival Meeting":"#496f96","Special Meeting":"#8b5aa4"};
export function categoryTextColor(category:string){return COLORS[category]??"#817095";}
