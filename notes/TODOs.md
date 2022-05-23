## TODOs

MAY 9 WHATS LEFT:

Final Cleanup:
- Get 100% test coverage
- Run prettier
- Delete notes/ folder

Evan:

> V2 Protocol Planning/ Progress:

- (DONE) Installment Claims
- (DONE) Rollover Review
- (IN PROGRESS) Test coverage
 - need rebase after rollovers merge
 - remove modulus(2) require statement and try a 1 installment loan.
   - modify:
   ```
   if (terms.numInstallments % 2 != 0 || terms.numInstallments > 1_000_000)
           revert OC_NumberInstallments(terms.numInstallments);
   ```
   to
   ```
   if (terms.numInstallments <= 1 || terms.numInstallments > 1_000)
           revert OC_NumberInstallments(terms.numInstallments);
   ```
   To allow for loan terms anywhere between 2 - 1000 installment periods. One not allowed, this is a legacy loan type.

Mouzayan:

- Upgradeability and dependency architecture\
  ✅ &nbsp; Decide - which contracts should be upgradeable? What upgradebility pattern should they use?\
  ✅ &nbsp; Decide - which dependencies need to get passed in constructors for each contract?\
  ✅ &nbsp; Decide - of those dependencies, which should be changeable by an admin? Which should be immutable and / or only changeable by upgrade?\
  ✅ &nbsp; Outline the path to UUPS + ways to avoid storage clashes
- Outline changes to v2 Protocol to add upgradeability

✅ &nbsp; Future Scenarios List: What May Need to Change in the Future Scenarios\
✅ &nbsp; For each scenario, how would we make it possible? admin function or upgradeability etc...

✅ &nbsp; Look into [OZ upgrades plugin](https://docs.openzeppelin.com/upgrades-plugins/1.x/) for checks for conflicts, adds a deployment history you can check into git, wrapped "upgrade" functions for deploy scripts + other features\
✅ &nbsp; Compare with [Slither](https://github.com/crytic/slither/wiki/Upgradeability-Checks) plugin

✅ &nbsp; Review Origination PR

- Review Installments PR

Kevin:

- Write Origination tests
- Review installments PR

Leftover:

- Native rollovers
- Custom errors
- Move compiler to 0.8.11
- Re-do natspec - move to implementation, not interfaces
- Testing with full coverage
