## TODOs

Evan:
- Write installments tests
- Review Origination PR

Mouzayan:
- Upgradeability and dependency architecture\
 ✅ &nbsp; Decide - which contracts should be upgradeable? What upgradebility pattern should they use?\
 ✅ &nbsp; Decide - which dependencies need to get passed in constructors for each contract?\
 ✅ &nbsp; Decide - of those dependencies, which should be changeable by an admin? Which should be immutable and / or only changeable by upgrade?
 - Outline the path to UUPS + ways to avoid storage clashes

✅ &nbsp; Future Scenarios List: What May Need to Change in the Future Scenarios\
✅ &nbsp; For each scenario, how would we make it possible? admin function or upgradeability etc...

 ✅ &nbsp; Look into [OZ upgrades plugin](https://docs.openzeppelin.com/upgrades-plugins/1.x/) for checks for conflicts, adds a deployment history you can check into git, wrapped "upgrade" functions for deploy scripts + other features\
✅ &nbsp; Compare with [Slither](https://github.com/crytic/slither/wiki/Upgradeability-Checks) plugin


- Review Installments PR and Origination PR

Kevin:
- Write Origination tests
- Review installments PR

Leftover:
- Native rollovers
- Custom errors
- Move compiler to 0.8.11
- Re-do natspec - move to implementation, not interfaces
- Testing with full coverage