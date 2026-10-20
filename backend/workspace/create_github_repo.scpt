tell application "System Events"
	delay 2
	set frontApp to name of first application process whose frontmost is true
	tell application process frontApp
		set repoField to missing value
		repeat with f in (every text field of entire contents of front window)
			try
				if description of f contains "repository" or description of f contains "Name" then
					set repoField to f
					exit repeat
				end if
			on error
			end try
		end repeat
		if repoField is not missing value then
			set value of repoField to "testing"
		end if
		delay 1
		repeat with b in (every button of entire contents of front window)
			try
				set n to name of b
				if n contains "Create repository" or n contains "Create" then
					click b
					exit repeat
				end if
			on error
			end try
		end repeat
	end tell
end tell