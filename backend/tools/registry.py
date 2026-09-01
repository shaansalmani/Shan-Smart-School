from typing import Callable, Any
from pydantic import BaseModel, Field

class ToolDefinition(BaseModel):
    name:str=Field(...); description:str=Field(...); category:str="general"; enabled:bool=True
class ToolRegistry:
    def __init__(self): self._tools={}; self._executors={}
    def register_tool(self,name,description,category="general",executor=None):
        self._tools[name]=ToolDefinition(name=name,description=description,category=category);
        if executor:self._executors[name]=executor
    def get_tool(self,name): return self._tools.get(name)
    def list_tools(self): return list(self._tools.values())
    def has_tool(self,name): return name in self._tools
tool_registry=ToolRegistry()
