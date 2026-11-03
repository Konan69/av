/** A separate camera exercise; normal musical comparison clips keep their fixed view. */
export function parallaxClip(){
 return {name:'parallax',kind:'camera-test',label:'Scripted 3D parallax test — camera translation and yaw',start:60,duration:12,
  viewPlan:[0,12,-12,0].map((azimuth,index)=>({seconds:index*3,view:{azimuth,elevation:0,distance:[0,1.5,-1.5,0][index]}}))};
}
