How does upgradeability work?
The user interacts with the implementation contract / logic contract via a proxy contract.
The proxy contract is able to store the address of the logic contract.
An upgarde is incoporrated by deploying a new logic contract and upgrading that contract's info in the proxy contract.

Most Proxy patterns use the transaprent proxy and UUPS (universal upgradeable proxy standard) patterns.

Transparent vs. UUPS Proxy
Transapreant Proxy Patterns Type:



