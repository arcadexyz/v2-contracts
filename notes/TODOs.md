## TODOs

MAY 9 WHATS LEFT:

Safety/Robustness:

- Fix test suite and ensure 100% coverage or as close as possible

Refactoring:
- Split LoanCore into separate files
  - (contract too big)
  - (merge create and start loan)
  - (if not merging, start clock in startLoan)
  - (check setFeeController for address 0 and emit event)
  - (add isNonceUsed function)
  - (remove SafeMath)
- Custom errors
- Run prettier

Features:

- Installment Claim
- Signature expiry
- Move origination fee to fee controller
- Native rollovers

Evan:

V2 Progress:

- (Ready for Review) Custom Errors
  - Lending.sol
    - (DONE) OC - Kevin
    - (DONE) IV - Kevin
    - (DONE) RC
    - (DONE) LC
    - (DONE) FILC
    - (DONE) PN
  - LendingUtils.sol
    - (DONE) ERC721P
    - (DONE) ERC721PU
    - (DONE) PunkRouter
  - Vault.sol
    - (DONE) AssetVault
    - (DONE) OwnableERC721
    - (DONE) VaultFactory
 - BEFORE MERGING:
    - Go through natspec in error files to ensure they are up to standard.
    - Remove the `TODO: custom errors` from top of contracts.
    - Modify the tests so they do not fail due to new errors.

📌 For Further Review Items:

- Tune LoanTerms dials for what will be accepted. Namely: `durationSeconds` and `numInstallments`.
- Global parameters, `LATE_FEE` and `GRACE_PERIOD`
- `claim` functionality with installment loans, with grace period?

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
