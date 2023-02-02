# Performance improvement of creating states of timeline charts

Date: 2023-01-20

## Timeline chart performance when zooming

When zooming/resizing with the timeline charts, the Trace Extension might become unresponsive for a while. This might last from a 1-2 seconds, to 20-30 seconds or even more. It looks like the more states that the timeline chart needs to render, the slower the responsiveness become. This document records an attempt to analyze and identify the bottlenecks that might be the cause of this issue. 

## System info and test trace

The following tests were run on:

1. CPU: 11th Gen Intel(R) Core(TM) i5-1145G7 @ 2.60GHz   1.50 GHz
2. GPU: Intel® Iris® Xe Graphics
3. RAM: 32 GB

Profiling tools used:

1. Firefox Profiler
2. Chrome performance tool

Matthew Khouzam provided a trace with more than 20000 states that are rendered closely together. I will use this trace to perform profiling.

### Sample run

When zooming in with the timeline chart, the chart perform the following actions.

1. First, the on zoom handlers are triggered. This includes:

| Component | Time in ms | Time in % |
|---|---|---|
|TimeGraphAxis|2.63|8.19|
|TimeGraphStateController|27.35|85.2|
|TimeGraphNavigator|0.11|0.34|
|TimeGraphChart|0.88|2.74|
|Total time|32.10|100|

Looking at the numbers, looks like TimeGraphStateController is consuming most of the time at `85.2%`.

So further investigation shows that the function `updateScaleAndPosition()` int TimeGraphStateController is consuming `25ms`, about `77.88%` of the on zoom handlers running time. 










|updateScaleAndPosition()|addOrUpdateRow()||HTTP handling time|
|---|---|---|---|
||removeRow()|addRow()||
|25ms|||


## Zooming

I started by analyzing the performance of zoom in/zoom out actions in the trace extensions. To have a general understanding of the situation, I first run a few trials with Firefox profiler. With Firefox profiler, I can use the call tree view to aggregate the total time the chart spend rendering the data to the canvas.

### Test

#### Parameters

1. The pre-zoom range is [1673902638.805 000 000; 1673902638.808 000 000].
2. Number of rows updated should be `45 rows`.
3. After zooming, the number of states modified should be around `3500 states` (in my case I have `3486 states`).

#### Steps

1. Open Matthew's trace using the Trace Extension
2. Open a timeline chart, such as the `Flame Chart` view. 
3. Right-click and set the view range to [1673902638.805 000 000; 1673902638.808 000 000].
4. Start Firefox profiler.
5. Perform a single zoom in action using the mouse wheel.
6. Wait around 2-3 seconds to make sure that the rendering is finished.
7. Stop the profiler
8. Repeat the test for each trial, then each special case.

### Results

Firefox profiler shows that the majority of time is spent rendering `PIXI.Graphics` objects, which is expected. 

|  Profiling description | renderLabel() <sup>1</sup>  | rect() <sup>2</sup> | TimeGraphStateComponent constructor | Traced running time <sup>4</sup>  |
|---|---|---|---|---|
|  Trial 1 | 7.9ms | 63.8ms | 94.5ms | 3048ms |
|  Trial 2 | 16.7ms | 102ms | 421ms | 4479ms |
|  Trial 3 | 10.5ms | 57.3ms | 136ms | 3549ms |
|  Average | 11.7ms | 74.37ms | 217.17ms | 3,692ms |
|  Without rectangles | 11.2ms | N/A | 145ms | 2156ms |
|  Without labels | N/A | 67.9ms | 113ms | 4178ms |


<sup>1</sup> Total time building labels, including text truncation.

<sup>2</sup> Total time spent building state backgrounds (rectangles).

<sup>3</sup> Time spent creating new state objects

<sup>4</sup> Total time to perform a single zoom action.

<img src="../images/001/Time%20spent%20constructing%20state%20objects.png" alt="Performance analysis on zooming" width="600"/>
<img src="../images/001/average%20zoom%20time.png" alt="Performance analysis on zooming" width="600"/>

### Analysis

On average, the time took to perform a single zoom on my machine is `13,692ms`. The average time took to build the label with our native code is much faster than building the background (the rectangle boundary) of each state, about `6.35 times` at `74.37ms`. Not drawing the state rectangle cuts the zooming time by almost half.

According to `PIXI.JS` guide, we use our native code to build the rectangular border of each state, then PIXI itself will handle the rendering. Given Matthew's trace contains a huge number of states, and building the states border increases the time for each zoom action, we need to investigate how many states that is being drawn in each zoom, and what is PIXI's recommended threshold. We will comeback to this topic later.

## Bottlenecks

To further identify other bottlenecks, another profiling analysis was done on Matthew's trace, this time with a lot more rows so that we have a large number of states that is displayed. 

### Test

1. Open Matthew's trace using the Trace Extension
2. Open a timeline chart, such as the `Flame Chart` view.
3. Make sure that there are a reasonable amount of rows displayed in the timeline chart so that we have a substantial amount of states.
4. Start Firefox profiler.
5. Perform a single zoom in action using the mouse wheel.
6. Wait around 2-3 seconds to make sure that the rendering is finished.
7. Stop the profiler
8. Repeat the test for each trial, then each special case.

### Results

1. The total time took to perform a single zoom in action for this particular trace is `6158ms`
2. The time took to handle the zoom change, especially the operation `updateScaleAndPosition()` is consuming `311ms`, which is `5.05%` of the total time.
3. The time took to re-render the chart, after [2], is `1985ms`, which is `32.09%` of the total time.
4. When a zoom action is performed, the chart would fetch the new state data from the server. This is debounced by `400ms` in the code and took `2500ms` from start to finish. The amount of time that is spent doing nothing by the server while waiting for the request to be resolved is `1,257ms`, which is `20.41%` of the total time.
5. The time took to update the rows after the states data is received is `788ms`, which is `12.80%` of the total time.
6. The time took to render what was changed in [5] is `1348ms`, which is `21.89%` of the total time.

<img src="../images/001/Zoom%20performance%20analysis.png" alt="Performance analysis on zooming" width="600"/>

### Observations

1. Our code contributes to `1089ms`, which is almost 1s or `17.85%` of the total time (see [2] and [5]). Thus, we can optimize our code to be faster. In addition, our code triggers `PIXI.JS` to rerender the components in the timeline chart. Thus, the amount of objects added/modified/created will affect the time in [3] and [6]. Optimize point [2] and [5] will thus greatly improve the rendering time of the timeline chart.
2. Another point of optimization is the fetching of the states data in point [3], which will be discussed shortly. So that the chart don't have to wait `20.41%` of the loading time doing nothing.
   
## Network delays

It was mentioned before by a colleague that the HTTP requests was a bottleneck to the performance of the chart, so I also ran some analysis on it.

### Test

1. Open Matthew's trace using the Trace Extension
2. Open a timeline chart, such as the `Flame Chart` view.
3. Start Firefox profiler.
4. Perform a 6 consecutive zoom in action using the mouse wheel, a few seconds apart to make sure everything is loaded.
5. Wait around 2-3 seconds to make sure that the rendering is finished.
6. Stop the profiler.

### Results

| Zoom # | States ||| Annotations | Arrows | XY | Total |
|---|---|---|---|---|---|---|---|
|| Total time | HTTP request<sup>1</sup> | HTTP response |||||
| 1 | 1100 | 786 | 257 | 39.7 |	164 | 30.7 | 1334.4 |
| 2 | 1300 | 940 | 335 | 41.3 |	39.8 |	37.2 | 1418.3 |
| 3 | 1700 | 1200 |	479 | 44.6 | 43.6 |	69.8 | 1858 |
| 4 | 1800 | 1326 |	427 | 66.7 | 65.7 |	49.5 | 1981.9 |
| 5 | 1100 | 465 | 591 | 42.6 |	39.1 | 72.5	| 1254.2 |
| 6 | 986 |	427 | 554 |	87.4 | 86.5 | 57.6	| 1217.5 |
| Total | 7986 | 5144 | 2643 | 322.3 | 438.7 | 317.3 | 9064.3 |
| Average | 1331 | 857.33 | 440.5 | 53.72 | 73.12 | 52.88 | 1510.72 |

<sup>1</sup>: Including HTTP request and response wait time.


<img src="../images/001/HTTP_analysis_all_data.png" alt="HTTP analysis all data" width="600"/>

<img src="../images/001/HTTP%20analysis%20states%20only.png" alt="HTTP analysis states only" width="600"/>

### Observations

As we can see, the number of time required for fetching states takes up a large percentage of loading time for each zoom in, compare to other HTTP requests. 

1. On average, the time takes to fetch states data for a single zoom action is `1331ms` in which HTTP request and response handling time take up the majority of the time.
2. Sending and waiting for states data takes `857.33ms`, or `56.75%` of the zoom time.
3. The time took to process the HTTP response is `440.5ms` or `29.16%` of the average zoom time.

So [2] and [3] are the major bottleneck when it comes to HTTP communication with the server.

## Investigation of state count threshold

To further this investigation, I ran some more test with Matthew's trace with some code modification to see how the number of states impact the rendering speed of the timeline chart. This experiment will focus on modifying the `updateScaleAndPosition()` function, because it is known to hog the performance of the timeline chart.

## Experiment

I added a threshold in the code to limit the number of states that the `updateScaleAndPosition()` function can update for the timeline chart. The actual number of `state objects` can varies from zoom to zoom, because each state in a trace can have the state itself and a gap that is associated with it. Both the state and the gap are abstracted to be `state objects` in the code.

### Test

1. Open Matthew's trace using the Trace Extension
2. Open a timeline chart, such as the `Flame Chart` view.
3. Start Firefox profiler.
4. Perform a 6 consecutive zoom in action using the mouse wheel, a few seconds apart to make sure everything is loaded.
5. Wait around 2-3 seconds to make sure that the rendering is finished.
6. Stop the profiler.
7. Update the threshold and perform the test again.

### Results

|Threshold|Acutal states updated|TimeGraphState objects created/updated|updateScaleAndPosition() time|Total time|
|---|---|---|---|---|
|500|500|500|17.53ms|1211ms|
|1000|1000|1003|34.07ms|1520ms|
|5000|5000|5056|76.34ms|1633ms|
|10000|10000|11933|71.88ms|1604ms|
|20000|20000|22637|150.65ms|1887ms|
|30000|27792|26936|230.92ms|1937ms|
|40000|39607|41455|398.06ms|2071ms|

<img src="../images/001/state%20count%20vs%20render%20time.png" alt="State count vs render time" width="600"/>

### Observations

1. Visually, without any  profiler, at 500 states the chart runs smoothly. From 1000-5000 states, the chart runs with some delay. From 10000 and above, states the performance issue is more noticeable with more states updated/modified.
2. Looking at the graph, we can see that the slope of the performance line is less steep at around 11000 states updated, then after that, it suddenly becomes much steeper afterwards. From the graph it looks like for my setup 11000 states is where performance takes a big dip.

## Delay when panning horizontally

When panning Matthew's trace horizontally, there is a large delay when we outside of the chart cached range. A profiling attempt shows that there is a `3566ms` delay (red highlight) between the moment the user stop panning and the moment the timeline chart start fetching data from the server to render the uncached portion of the trace (blue highlight).

<img src="../images/001/PanningDelay.PNG" alt="Panning delay" width="800"/>

## Resizing analysis

Next, we analyze the time take perform a single resize action with the timeline chart. The arrangement is done as follow:

### Test

1. Open a timeline chart in the trace extension
2. Expand the chart to the total height of the screen, so that we have a decent amount of states displayed.
3. Resize the browser window so that it is smaller than the width of the screen
4. Start Chrome profiling
5. Expand the browser width
6. Stop Chrome profiling

### Observations

Looking at the profiling data, we have the following observation:
1. The total time took from the moment the user finish resizing the window to the moment a change is made in the timeline chart is `1373ms`.
2. The total time for updating and rerendering the timeline chart is `2011ms`.
3. The total time to run `updateScaleAndPosition()` twice is `179.81`+`65.30`=`245.11ms`.

It looks like the `updateScaleAndPosition()` function is again the bottleneck for resizing the chart.

## Conclusion

1. As noted before `updateScaleAndPosition()` is a major bottle neck of the performance of the timeline chart. Fixing it should be the priority since it affects many features of the timeline chart, such as zooming and panning.
2. Improve HTTP request/response time should also significantly improve the performance of the chart.
3. Finally, we might need to optimize the number of states that can be displayed on the chart at a single time. The threshold is to be determined. 


### IMPROVEMENT

For each test, add:
1. Number of rows
2. Screen resolution
3. Number of states in total
4. Zoom in level + time range

**More analysis on**
Deletion and reconstruction time for objects
Labels in test is important
Investigation for `addOrUpdateRow()`, without AND without labels

Replace Matthew's trace with example trace


















