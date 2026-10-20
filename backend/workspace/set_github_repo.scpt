tell application "System Events"
	delay 3
	set frontApp to name of first application process whose frontmost is true
	 tell application process frontApp
		set allFields to every text field of entire contents of front window
		repeat with f in allFields
			try
				set fieldDesc to description of f
				if fieldDesc contains "repository" or fieldDesc contains "Name" then
					set value of f to "testing"
					exit repeat
				end if
			on error
			end try
		end repeat
	end tell
end tell