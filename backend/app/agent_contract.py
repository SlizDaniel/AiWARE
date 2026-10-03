"""Bridge between LLM function calls and the shared offline tool registry."""
from copy import deepcopy

from app.llm import LLMProviderError, ToolCall
from app.models import ItemRef
from app.parser import ParsedCommand
from app.tools import TOOL_REGISTRY


def tool_schemas() -> list[dict]:
    schemas = []
    for spec in TOOL_REGISTRY.values():
        parameters = deepcopy(spec.parameters)
        parameters["additionalProperties"] = False
        properties = parameters["properties"]
        if spec.name == "update_stock":
            # The server records the user's original command, not model-supplied text.
            properties.pop("text", None)
        for prop in properties.values():
            if prop.get("type") == "string":
                prop["minLength"] = 1
        if "item_id" in properties:
            properties["item_id"]["minimum"] = 1
        if "quantity" in properties:
            properties["quantity"]["minimum"] = 1 if spec.name == "draft_order" else 0
        schemas.append({"type": "function", "function": {
            "name": spec.name,
            "description": spec.description,
            "parameters": parameters,
        }})
    return schemas


def normalize_call(call: ToolCall, text: str, items: list[ItemRef]) -> ParsedCommand:
    if call.name not in TOOL_REGISTRY:
        raise LLMProviderError("Tool is not registered")
    args = dict(call.arguments)
    for key, value in args.items():
        if isinstance(value, str):
            args[key] = value.strip()
            if not args[key]:
                raise LLMProviderError("Tool argument cannot be blank")
    item = None
    if "item_id" in args:
        item = next((item for item in items if item.id == args["item_id"]), None)
        if item is None:
            raise LLMProviderError("Tool references a missing inventory item")
    if call.name == "update_stock" and args.get("delta") == 0:
        raise LLMProviderError("Stock change cannot be zero")
    return ParsedCommand(
        tool=call.name, text=text, args=args,
        item_id=item.id if item else None,
        item_name=item.name if item else None,
    )
