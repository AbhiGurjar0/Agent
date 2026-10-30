# Start

## Normal Chat flow 

# User hit the api 
 -> 1. we reached at api -> ("/" POST) , function -> create_chat
 -> 2.then the create chat pipeline will handle the full chat operation
 -> 3.here it parallely do embedding for user message 
 -> 5.get recent 10 chats
 -> 6.create system context
 -> 7.create the db entry for user message
 -> 8.here we check like the task is complex or not 
 is_not_complex ->
 -> 9.the planner run the task
 -> 10.create entry in db 
  is_complex ->
 -> 9.Run all tools with cancel tools option also 
 -> 10.create entry in db 


1.There is a worker created for continuous scrren sharing
2.tool synthesizer for creating tools by own 
3.self_healign agent like if any popup or error comes then they will handle that 
4.approval manager for approving the risky tasks
5.wakeup option added for interruption
6.


 

