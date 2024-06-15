import cv2
import os
import numpy as np
import pyautogui
import time
from art import *
from colorama import Fore
import requests
import datetime
import threading
import subprocess
from ctypes import cast, POINTER
from comtypes import CLSCTX_ALL
from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume

# Set sound volume to zero
device = AudioUtilities.GetSpeakers()
interface = device.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
volume = cast(interface, POINTER(IAudioEndpointVolume))

volume.SetMasterVolumeLevel(-65, None)

pyautogui.FAILSAFE = False 

#Search file
def search(file_name):
    for root, dirs, files in os.walk("C:\\"):
        if file_name in files:
            source_path = os.path.join(root, file_name)
            print(f"Modern Warship found at {source_path}")
            current = os.getcwd()
            data = "DUST_DATA"
            os.makedirs(os.path.join(current, data), exist_ok=True)
            with open(os.path.join(data, "path.txt"), "a") as file_paths:
                file_paths.write(f"{source_path}")
            return source_path
    print(f"File {file_name} not found. You can create a file named path.txt, enter Modern Warship path manually and move it to DUST_DATA folder")

print("Checking")

#-----------------------Working folder
start_folder = os.path.join(os.getcwd(), 'start')

image_folder = os.path.join(os.getcwd(), 'images')

one_esc = os.path.join(os.getcwd(), 'one_esc')

two_esc = os.path.join(os.getcwd(), 'two_esc')

farm =  os.path.join(os.getcwd(), 'invisible_farm.exe')

rounds = os.path.join(os.getcwd(), 'round.txt')
#----------------------------------------

try:
    file_path = os.path.join(os.getcwd(), 'DUST_DATA\\path.txt')
    with open(file_path, 'r') as f:
        pass
    print("Path exist!")
except FileNotFoundError:
    print("File does not exist")
    print("Finding Modern Warship.exe")
    search("Modern Warships.exe")
    os.system("cls")

a = 0

# MAIN FUNCTION --------------------------------------------------

def image(folder):
     # Take a screenshot using pyautogui
    pyautogui.keyDown('alt')
    pyautogui.press('tab')
    screenshot = pyautogui.screenshot()
    pyautogui.keyUp('alt')

    # Convert the screenshot to a numpy array
    screenshot_array = np.array(screenshot)

    # Convert the screenshot to BGR format
    screenshot_bgr = cv2.cvtColor(screenshot_array, cv2.COLOR_RGB2BGR)

    for file in os.listdir(folder):
        # Read the image file
        img_path = os.path.join(folder, file)
        img = cv2.imread(img_path, cv2.IMREAD_GRAYSCALE)

        # Check if the image is read correctly
        if img is None:
            print(f"Error: Unable to read image {file}")
            continue

        # Convert the screenshot to grayscale
        screenshot_gray = cv2.cvtColor(screenshot_bgr, cv2.COLOR_BGR2GRAY)

        # Perform template matching
        result = cv2.matchTemplate(screenshot_gray, img, cv2.TM_CCOEFF_NORMED)

        # Convert to value
        res = result[0][0]

        # Send back the result
        return res
    
def check():
    while True:
        now = time.time()
        if now - last > 5:
            print("Error!")
            webhook_url = 'https://discord.com/api/webhooks/1244986124137664582/Y0tzdbjl21sadUH7hgDS3mZhfcwchLmpq1j2Lln_Qxt0AhtUOz2TcxLJzqyB5kwz8fMF'  # Replace with your webhook URL
            message = "SAD_DUST#1980 has face an error ? at " + str(datetime.datetime.now()) + " retry in 3 second"
            data = {'content': message}
            response = requests.post(webhook_url, data=data) 
            time.sleep(3)
            if image(one_esc) > 0.9:
                time.sleep(0.3)
                pyautogui.press('esc')
            elif image(two_esc) > 0.9:
                time.sleep(0.2)
                pyautogui.press('esc')
                time.sleep(0.7)
                pyautogui.press('esc')
            else:
                time.sleep(0.5)
                os.system("taskkill /f /im Modern Warships.exe")
                os.system('taskkill /f /im "Modern Warships.exe"')
            break
#----------------------------------------------------------------------------------------------------------------------

print(Fore.RED ,text2art("MODERN    WARSHIPS    AUTOFARM"))
print(Fore.GREEN, "MADE BY SAD_DUST#1980")
print(Fore.RED, "You can see previous round farmed in round.txt")
print(Fore.RED, "Less images in images folder = less lag (recommend 30-60 for fast farm, > 70 better but more resource)")
print(Fore.GREEN, "The farm is started, Please wait!!")

time.sleep(5)

def start():
    file_path = os.path.join(os.getcwd(), 'DUST_DATA\\path.txt')

    with open(file_path, 'r') as f:
        path = f.read().strip()

    if os.path.exists(path):
        os.startfile(path)
    else:
        print("We got error the file not exist ?")
        os.remove(path)
        search("Modern Warships.exe")
        exit()

    time.sleep(5*60)

    if image(start_folder) > 0.95:
        pyautogui.press('esc')
        
start()
time.sleep(5) 

while True:
    if image(image_folder) > 0.95:
        # Make screen dark
        os.system("powershell (Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1, 0)")

        global last
        os.startfile(farm)
        if a != 0:
            webhook_url = 'https://discord.com/api/webhooks/1244986124137664582/Y0tzdbjl21sadUH7hgDS3mZhfcwchLmpq1j2Lln_Qxt0AhtUOz2TcxLJzqyB5kwz8fMF'  
            message = "SAD_DUST#1980 has played round : " + str(a) + " and earned about " + str(a*200000) + " at " + str(datetime.datetime.now())
            data = {'content': message}
            response = requests.post(webhook_url, data=data)            
        a = a + 1
        with open(rounds, 'w') as f:
            f.truncate(0)
            f.write("I have farmed : " + str(a) + " and earned about " + str(a*200000) + " at " + str(datetime.datetime.now()))
        print("Ran")
        last = time.time()
        d = threading.Thread(target=check)
        if threading.Thread.is_alive(d):
            continue
        else:
            d.start()
        time.sleep(2.5*60)
        break
    time.sleep(10)        