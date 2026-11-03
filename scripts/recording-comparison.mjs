/** A clip label alone cannot establish that two recordings cover the same music. */
export function samePassage(left,right){
 return left.name===right.name&&Math.abs(Number(left.start)-Number(right.start))<=0.01+1e-9&&Math.abs(Number(left.duration)-Number(right.duration))<=0.01+1e-9;
}
