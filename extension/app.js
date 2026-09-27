
console.log('Strava summarize init');
var entries = 0;
var newVersion = false; 
var DateTime2 = luxon.DateTime;
var Duration = luxon.Duration;
var retry =0

var data = [];


var htmlTemplate = `
<style>
.loader {
  border: 3px solid #f3f3f3;
  border-radius: 50%;
  border-top: 3px solid blue;
  border-right: 3px solid green;
  border-bottom: 3px solid red;
  border-left: 3px solid pink;
  width: 15px;
  height: 15px;
  -webkit-animation: spin 2s linear infinite;
  animation: spin 2s linear infinite;
}

@-webkit-keyframes spin {
  0% { -webkit-transform: rotate(0deg); }
  100% { -webkit-transform: rotate(360deg); }
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
</style>
<div  onclick="document.getElementById('sumapp').style.display='block'" style="position: fixed; top: 50px; right: 20px; z-index: 100001;" class="btn btn-primary">
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-bar-chart-line-fill" viewBox="0 0 16 16">
    <path d="M11 2a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v12h.5a.5.5 0 0 1 0 1H.5a.5.5 0 0 1 0-1H1v-3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v3h1V7a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v7h1V2z"/>
    </svg> &nbsp; Reports
</div>
<input type="hidden" id="mycmd" value="">
<div id="sumapp" style="z-index: 1000002;background-color:  #00000069; position: fixed; top: 0px; right: 0px; bottom: 0px; left: 0px; height: 100vh; padding: 50px 50px 50px 50px; display:none" class="">

    <div style="width: auto; height: calc(100vh - 150px); background-color: whitesmoke; padding: 20px;">
        <div style="height: 50px;">
            <a type="button" class="btn btn-primary" href="javascript:window.scrollTo(0,document.body.scrollHeight-1000);">Load more</a>
            <a id='dlLink' class='btn btn-primary' href='#'>Download csv</a>
            
            <input type="button" class="btn btn-default float-right" value="X" onClick="document.getElementById('sumapp').style.display='none'" >
            <div id="itemCounts" class="float-right" style="padding-top: 10px; padding-right: 10px">Items: 0</div>
        </div>
        <div style="height: calc(100% - 80px);overflow:auto;" >
            <div id="sumWrapper">
            <table id="extable" style="width: 100%;"><tr><td></td><td><b>Name</b></td><td><b>Date</b></td><td><b>Distance</b></td><td><b>Pace</b></td><td><b>Unit</b></td><td><b>Time</b></td><td><b>Elev</b></td><td><b>Cal</b></td><td></td></tr>
            </table>
            </div>
        </div>
        <div class='float-right' >
            Don't see the data: <input type="button" class="btn btn-default btn-sm" value="Change to English" onClick="document.querySelector('#language-picker > ul > li:nth-child(3) > div').click()">
        </div> 

    </div>
</div>`


$(document).ready(function(){
    newVersion = isNewVersion();

    // if (!newVersion){
    //     var feedRouter = $('div[data-react-class=FeedRouter]')
    //     if (feedRouter.length == 0) return;
    // }else{
        //  var feedRouter = $('div.feed-ui')
        //  if (feedRouter.length == 0) return;
    // }

    if ($('div#sumWrapper').length == 0){
        // console.log('Add html')

        $('body').prepend(htmlTemplate);
    }

    setInterval(loadActivities, 2000);

})

function isNewVersion(){
    // return $('div[data-react-class=FeedRouter]').length > 0
    console.log('new version')
    return $('div.feed-ui').length > 0

}

function updateDownload(){
    var csvContent = `data:text/csv;charset=utf-8,`
    csvContent += `"Athlete","Activity", "Type","Location","Name","Date","Distance","Pace","Unit","Duration","Elev","Calo","EstPace","EstSpeed"\n`

    data.map(a => {
        csvContent += `"${a.athleteId}","${a.activityId}","${a.type || 'unknown'}","${a.activity_name}${a.location}","${a.name}","${a.time}","${a.distance}","${a.pace}","${a.unit}","${a.duration}","${a.elev}","${a.calo}","${a.estpace}","${a.estspeed}"\n`;
    })

    var encodedUri = encodeURI(csvContent);
    var d = new Date();
    var filename = `data-${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}-${d.getHours()}.csv`
    $("#dlLink").attr('href', encodedUri).attr('download', filename);

}


function showActivities(){

    var htmlTable = `<table id="extable" style="width:100%"><tr><td></td><td><b>Location</b></td><td><b>Name</b></td><td><b>Date</b></td><td><b>Distance</b></td><td><b>Pace</b></td><td><b>Unit</b></td><td><b>Time</b></td><td><b>Elev</b></td><td><b>Calo</b></td><td style="color: red"><b>Est Pace</b></td><td style="color:red"><b>Est Speed</b></td></tr>`
    // data.sort((a, b) => { return new Date(b.time) - new Date(a.time) })
    data.map(a => {
        htmlTable += `<tr id='${a.activityId}' style='height:40px'><td><a href='${a.activityId}' target='_blank'>${a.type || 'unknown'}</a></td><td>${a.activity_name.trim()}${a.location}</td><td>${a.name}</td><td>${(new Date(a.time)).toLocaleString()}</td><td class='distance'>${a.distance}</td><td class='pace'>${a.pace}</td><td class='unit'>${a.unit}</td><td class='duration'>${a.duration}</td><td class='elev'>${a.elev}</td><td class='calo'>${a.calo}</td><td>${a.estpace}</td><td>${a.estspeed}</td></tr>`
    })

    $('div#sumWrapper').html(htmlTable);
    $('#itemCounts').html(`Items: ${data.length}`)
}

function loadActivities(){

    // var feedRouter = $('div.feed-ui')[0]

    //     if (feedRouter == null) return;
        var activities = $('*[data-testid=web-feed-entry]')

        if (activities.length == entries && retry > 3) return;
        
        data =[]
        retry++

        entries = activities.length;
    
    
         activities.each((i, e) => {
    
            buildActivityFromHtml(e);
       
        })

    showActivities();
    updateDownload();

    console.log(`feed counts: ${data.length}`);
}

function buildActivity(activity, timeLocation, isgroup = false){
    var stats = activity.stats;
    var distant = getValue(stats, 'Distance');
    var pace = getValue(stats, 'Pace');
    var duration = getValue(stats, 'Time');
    var time = getTime(timeLocation.displayDateAtTime)
    var cal = getValue(stats, 'Cal')
    var elev = getValue(stats, 'Elev Gain')

    var name = (activity.athlete)?activity.athlete.athleteName : activity.athlete_name
    var activityId = activity.id || activity.entity_id
    name = name.replace("\"","").replace("#", "")

    // console.log(activityId)
    // console.log(duration)

    if (data.findIndex(e => e.activityId == activityId) < 0) {

        var {tunedDur, tunedObj} = tuneDuration( duration.value)
        var durMinutes = Duration.fromObject(tunedObj).shiftTo('minutes').minutes;
        var durHours = Duration.fromObject(tunedObj).shiftTo('hours').hours
        var dis = parseFloat(distant.value.replace(",",""))

        var estpace = "", estspeed = ""
        
        if (dis > 0){
            if (distant.unit == 'm'){
                dis = dis/100
            }

            estpace = Duration.fromObject({minutes: durMinutes/dis}).shiftTo("minutes", "seconds").toFormat('m:ss') + ((distant.unit == 'm')?'/100m':'');
        }

        if (durHours > 0 && dis > 0){
            if (activity.type.toLowerCase() == 'swim'){
                dis = dis/10
            }
            estspeed = (dis/durHours).toFixed(1);
        }

        data.push({
            "activityId": activityId,
            "type": activity.type,
            "name": name,
            "location": timeLocation.location || '',
            "time": time.value,
            "distance": distant.value,
            "pace": pace.value,
            "estpace": estpace,
            "estspeed": estspeed,
            "unit": distant.unit,
            "duration": tunedDur,
            "elev": elev.value,
            "calo": cal.value,
            "status": "new"
        })
    }

    return {activityId}
}

function tuneDuration(str){
    var parts = str.trim().split(" ");
    var h ='0', m ='0', s ='0';
    parts.forEach(p => {
        if (p.endsWith('h')){
            h = p.replace("h","");
        }
        if (p.endsWith("m")){
            m = p.replace("m", "");
        }
        if (p.endsWith("s")){
            s = p.replace("s", "")
        }
    })

    return {tunedDur: `${h.padStart(2,0)}:${m.padStart(2,0)}:${s.padStart(2,0)}`, tunedObj: {hours:h, minutes: m, seconds: s}}
}

function getTime(timeStr) {

    try {
        timeStr = timeStr.replace("at ", "")
        var today = DateTime2.now().toFormat('LLLL dd, yyyy');
        var yesterday = DateTime2.now().plus({days: -1}).toFormat('LLLL dd, yyyy');
        timeStr = timeStr.replace("Today", today);
        timeStr = timeStr.replace("Yesterday", yesterday);
        
        if (!timeStr.endsWith('M')){
            timeStr += ' 0:0 AM'
        }

        var d = DateTime2.fromFormat(timeStr, "LLLL d, yyyy h:m a");
        // console.log('Timestring ' + timeStr + ' ' + d.toISO())
        return {value: d.toISO(), unit: timeStr}
    } catch (error) {
        // console.log(error)
        return {value: "", unit: ""}

    }


}

function getValue(stats, typeName){
    var i = stats.findIndex((e) => e.value == typeName)
    if (i< 1) return {value: "", unit: ""}

    var parts = stats[i-1].value.split('<')
    let strippedString = parts[1].split('>')[1].replace(/(<([^>]+)>)/gi, "").trim();
    let strippedFull = stats[i-1].value.replace(/(<([^>]+)>)/gi, "").trim()
    return {value: (typeName == 'Time')? strippedFull : parts[0].trim(), unit: (typeName == 'Time')? strippedFull : strippedString}
}


function buildActivityFromHtml(e){
    var mainActivity = $(e);
    var timeStr = mainActivity.find('time[data-testid=date_at_time]').first().text()
    var time = getTime(timeStr)

    var location = mainActivity.find('div[data-testid=location]').first().text() || '';
    location = location.replaceAll('&nbsp;'," ").replaceAll("\"","").replaceAll("#", "")

    var groupActivities = mainActivity.find('div[data-testid=entry-header]');

    var isgroup = groupActivities.length > 1;
    
var subActivities = [], stats, name, distant, pace, duration, cal, elev, activityId, activityName, activityType, athleteId;
    
if (!isgroup) {
    subActivities.push(mainActivity)
}else{
    groupActivities.map((i,g) => {
        subActivities.push($(g).parent())
    })
}


    subActivities.forEach((a) => {
        var activity = $(a)
        stats = activity.find('div[data-testid=activity_entry_container] li')
        // stats = activity.find('span[class*=ActivityEntryBody-module__statLabel]')
        //Stats-Stats-module__listStats
    
        name = activity.find('a[data-testid=owners-name]').first().text()
   
       name = name.replaceAll("\"","").replaceAll("#", "")
   
        distant = getHtmlValue(stats, 'Distance');
        pace = getHtmlValue(stats, 'Pace');
        duration = getHtmlValue(stats, 'Time');
        cal = getHtmlValue(stats, 'Cal')
        elev = getHtmlValue(stats, 'Elev Gain')
   
        activityId = activity.find('a[data-testid=activity_name]').first().attr('href')
        activityName = activity.find('a[data-testid=activity_name]').first().text() || ''
       activityName = activityName.replaceAll('&nbsp;'," ").replaceAll("\"","").replaceAll("#", "")
        activityType = activity.find('svg[data-testid=activity-icon] > title').text() || ''
        // if (activityType == '')
        //     activityType = activity.closest('*[data-testid=web-feed-entry]').find('svg[data-testid=activity-icon] > title').text() || ''
    
 
        athleteId = activity.find('a[data-testid=owner-avatar]').first().attr('href')

   
       if (activityId && data.findIndex(e => e.activityId == activityId) < 0) {
   
           var {tunedDur, tunedObj} = tuneDuration( duration.value)
           var durMinutes = Duration.fromObject(tunedObj).shiftTo('minutes').minutes;
           var durHours = Duration.fromObject(tunedObj).shiftTo('hours').hours
           var dis = parseFloat(distant.value.replace(",",""))
   
           var estpace = "", estspeed = ""
           
           if (dis > 0){
               if (distant.unit == 'm'){
                   dis = dis/100
               }
   
               estpace = Duration.fromObject({minutes: durMinutes/dis}).shiftTo("minutes", "seconds").toFormat('m:ss') + ((distant.unit == 'm')?'/100m':'');
           }
   
           if (durHours > 0 && dis > 0){
               if (activityType.toLowerCase() == 'swim'){
                   dis = dis/10
               }
               estspeed = (dis/durHours).toFixed(1);
           }
   
           data.push({
               "activityId": activityId,
               "type": activityType || '',
               "name": name,
               "location":  location || '',
               "time": time.value,
               "distance": distant.value,
               "pace": pace.value,
               "estpace": estpace,
               "estspeed": estspeed,
               "unit": distant.unit,
               "duration": tunedDur,
               "elev": elev.value,
               "calo": cal.value,
               "status": "new",
               "activity_name": activityName || '',
               "athleteId": athleteId || ''

           })
       }
    })
     

    return {activityId}
}

function getHtmlValue(stats, typeName){
    var ret = {value: "", unit: ""}
    stats.each((i,e) => {
        var stat = $(e).find('span')
        if (stat.text() == typeName){
            
            var valueHtml = stat.parent().children()[1]
            var parts = valueHtml.innerHTML.split('<')
            let strippedString = parts[1].split('>')[1].replace(/(<([^>]+)>)/gi, "").trim();
            let strippedFull = valueHtml.innerHTML.replace(/(<([^>]+)>)/gi, "").trim()
            ret = {value: (typeName == 'Time')? strippedFull : parts[0].trim(), unit: (typeName == 'Time')? strippedFull : strippedString}
        
        }
    })
return ret;
    
}